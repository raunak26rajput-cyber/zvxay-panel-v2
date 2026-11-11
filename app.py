#!/usr/bin/env python3
import os, json, time, uuid, random, string, subprocess, signal, sys, zipfile, shutil, threading
from pathlib import Path
from datetime import datetime, date
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for, flash,
    session, send_file, jsonify
)
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker, scoped_session

from models import Base, User, Bot, KeyValue

# ─────────────────── Config ───────────────────

DATA_DIR   = Path(os.environ.get("DATA_DIR", "./data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
LOG_DIR    = DATA_DIR / "logs"
RUN_DIR    = DATA_DIR / "run"

for d in (DATA_DIR, UPLOAD_DIR, LOG_DIR, RUN_DIR):
    d.mkdir(parents=True, exist_ok=True)

DB_PATH      = DATA_DIR / "app.db"
ENGINE       = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)
SessionLocal = scoped_session(sessionmaker(bind=ENGINE, expire_on_commit=False))
Base.metadata.create_all(ENGINE)

app = Flask(__name__)
app.secret_key = (
    os.environ.get("SECRET_KEY")
    or os.environ.get("APP_API_KEY")
    or uuid.uuid4().hex
)

OWNER_USERNAME = os.environ.get("OWNER_USERNAME") or "admin"
OWNER_PASSWORD = os.environ.get("OWNER_PASSWORD") or ""
if not OWNER_PASSWORD:
    OWNER_PASSWORD = ''.join(random.choices(string.ascii_letters + string.digits, k=20))
    print(f"[BOOT] OWNER_PASSWORD not set - generated a random password for owner "
          f"'{OWNER_USERNAME}': {OWNER_PASSWORD}", flush=True)

RESTART_TRACK_FILE = Path("app_restart_tracker.json")
RESTART_WINDOW_SEC = 5 * 60
RESTART_LIMIT      = 6
BOT_LIMIT          = 2
ALLOWED_EXTS       = {".py", ".zip"}

# ─────────────────── Boot guard ───────────────────

def _register_start():
    now  = int(time.time())
    data = {"starts": []}
    try:
        if RESTART_TRACK_FILE.exists():
            data = json.loads(RESTART_TRACK_FILE.read_text())
    except Exception:
        data = {"starts": []}
    data["starts"] = [t for t in data["starts"] if now - t < RESTART_WINDOW_SEC]
    data["starts"].append(now)
    RESTART_TRACK_FILE.write_text(json.dumps(data))
    if len(data["starts"]) > RESTART_LIMIT:
        print("Too many restarts — exiting.")
        raise SystemExit(1)

_register_start()

# ─────────────────── DB helpers ───────────────────

def get_db():
    return SessionLocal()

def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    db = get_db()
    return db.get(User, uid)

# ─────────────────── Decorators ───────────────────

def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return redirect(url_for("login"))
        if u.is_expired():
            session.clear()
            flash("Invalid username or password.", "error")
            return redirect(url_for("login"))
        return fn(*a, **kw)
    return wrapper

def owner_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u or u.role != "owner":
            flash("Permission denied — Owner only.", "error")
            return redirect(url_for("dashboard"))
        return fn(*a, **kw)
    return wrapper

def approved_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return redirect(url_for("login"))
        if u.role == "owner":
            return fn(*a, **kw)
        if not u.approved:
            db = get_db()
            try:
                contact = get_contact_link(db) or "https://t.me/g0zig"
            finally:
                db.close()
            flash(
                f"⚠️ Access denied. Contact owner for approval. "
                f"<a href='{contact}' target='_blank' class='flash-link'>Contact Owner →</a>",
                "error",
            )
            return redirect(url_for("dashboard"))
        return fn(*a, **kw)
    return wrapper

# ─────────────────── KV helpers ───────────────────

def get_contact_link(db):
    kv = db.execute(select(KeyValue).where(KeyValue.k == "CONTACT_LINK")).scalar_one_or_none()
    return kv.v if kv else ""

def set_contact_link(db, value: str):
    kv = db.execute(select(KeyValue).where(KeyValue.k == "CONTACT_LINK")).scalar_one_or_none()
    if not kv:
        kv = KeyValue(k="CONTACT_LINK", v=value or "")
        db.add(kv)
    else:
        kv.v = value or ""
    db.commit()

# ─────────────────── User helpers ───────────────────

def strong_uid():
    p1 = ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))
    p2 = datetime.utcnow().year
    p3 = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"HOST-{p1}-{p2}-{p3}"

def ensure_owner_exists():
    db = get_db()
    try:
        u = db.execute(select(User).where(User.username == OWNER_USERNAME)).scalar_one_or_none()
        if not u:
            u = User(
                username=OWNER_USERNAME,
                password_hash=generate_password_hash(OWNER_PASSWORD),
                role="owner", approved=True, expiry=None
            )
            db.add(u); db.commit()
        else:
            changed = False
            if u.role != "owner":     u.role = "owner"; changed = True
            if not u.approved:        u.approved = True; changed = True
            if u.expiry is not None:  u.expiry = None;   changed = True
            if changed: db.commit()
    finally:
        db.close()

ensure_owner_exists()

def user_active_bot_count(db, user: User) -> int:
    return db.query(Bot).filter(
        Bot.owner_id == user.id,
        Bot.status.notin_(["deleted", "rejected"])
    ).count()

def user_limit_reached(db, user: User) -> bool:
    if user.role == "owner":
        return False
    return user_active_bot_count(db, user) >= BOT_LIMIT

# ─────────────────── File utilities ───────────────────

def score_py_file(rel_path: str) -> int:
    """Score a .py path for auto-detection (higher = better candidate as entry point)."""
    name  = Path(rel_path).name.lower()
    parts = Path(rel_path).parts
    depth = len(parts) - 1  # 0 = root
    score = 0

    priority_names = {"main.py": 100, "bot.py": 90, "app.py": 80, "index.py": 70,
                      "run.py": 65, "start.py": 60}
    score += priority_names.get(name, 40)
    score -= depth * 15  # penalise nested
    return score

def detect_main_file(py_files: list[str]) -> str:
    """Return best candidate from a list of relative paths."""
    if not py_files:
        return ""
    return max(py_files, key=score_py_file)

def list_zip_py_files(zip_path: Path) -> list[str]:
    """List .py files inside a zip, stripped of common top-level wrapper dir."""
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".py") and not n.startswith("__")]
    # Strip common prefix (GitHub-style zips)
    if names:
        parts = [Path(n).parts for n in names]
        prefix = parts[0][0] if all(p[0] == parts[0][0] for p in parts if p) else ""
        if prefix and all(n.startswith(prefix + "/") for n in names):
            names = [n[len(prefix)+1:] for n in names]
    return sorted(names)

def extract_zip(zip_path: Path, dest_dir: Path):
    """Extract zip, stripping common top-level wrapper dir."""
    with zipfile.ZipFile(zip_path) as zf:
        members = zf.namelist()
        # detect prefix
        parts = [Path(m).parts for m in members if m.strip("/")]
        prefix = parts[0][0] if parts and all(p and p[0] == parts[0][0] for p in parts) else ""
        for member in members:
            target = member
            if prefix and member.startswith(prefix + "/"):
                target = member[len(prefix)+1:]
            if not target.strip("/"):
                continue
            out = dest_dir / target
            if member.endswith("/"):
                out.mkdir(parents=True, exist_ok=True)
            else:
                out.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(out, "wb") as dst:
                    dst.write(src.read())

def find_requirements_file(bot_dir: Path) -> Path | None:
    """Find requirements.txt in bot directory."""
    for candidate in [bot_dir / "requirements.txt", *bot_dir.rglob("requirements.txt")]:
        if candidate.exists():
            return candidate
    return None

# ─────────────────── Process management ───────────────────

def _kill_pid(pid: int):
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.5)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    except ProcessLookupError:
        pass

# ── Auto-install launcher ─────────────────────────────
def _make_launcher(filepath: str) -> str:
    """Write a launcher that pre-checks imports and auto-installs missing packages."""
    p = Path(filepath).resolve()
    launcher_path = p.parent / f"_sc_launcher_{p.stem}.py"

    # Use __SCRIPT__ placeholder — avoids .format() conflicts with {{ }} in dicts/f-strings
    SCRIPT_REPR = repr(str(p))

    launcher_code = (
        "#!/usr/bin/env python3\n"
        "# ZVXAY Auto-Install Launcher v3\n"
        "import sys, subprocess, os, importlib.util\n"
        "\n"
        "SCRIPT = " + SCRIPT_REPR + "\n"
        "\n"
        "REMAP = {\n"
        "    'cv2':         'opencv-python',\n"
        "    'PIL':         'Pillow',\n"
        "    'bs4':         'beautifulsoup4',\n"
        "    'sklearn':     'scikit-learn',\n"
        "    'yaml':        'PyYAML',\n"
        "    'dotenv':      'python-dotenv',\n"
        "    'telegram':    'python-telegram-bot',\n"
        "    'discord':     'discord.py',\n"
        "    'Crypto':      'pycryptodome',\n"
        "    'serial':      'pyserial',\n"
        "    'aiofiles':    'aiofiles',\n"
        "    'aiohttp':     'aiohttp',\n"
        "    'google':      'google-generativeai',\n"
        "    'magic':       'python-magic',\n"
        "}\n"
        "\n"
        "def _get_imports(path):\n"
        "    import ast\n"
        "    mods = set()\n"
        "    try:\n"
        "        tree = ast.parse(open(path).read())\n"
        "        for node in ast.walk(tree):\n"
        "            if isinstance(node, ast.Import):\n"
        "                for a in node.names: mods.add(a.name.split('.')[0])\n"
        "            elif isinstance(node, ast.ImportFrom):\n"
        "                if node.module: mods.add(node.module.split('.')[0])\n"
        "    except Exception:\n"
        "        pass\n"
        "    return mods\n"
        "\n"
        "def _is_stdlib(mod):\n"
        "    if hasattr(sys, 'stdlib_module_names'):\n"
        "        return mod in sys.stdlib_module_names\n"
        "    import sysconfig\n"
        "    return mod in sys.builtin_module_names\n"
        "\n"
        "def _available(mod):\n"
        "    return importlib.util.find_spec(mod) is not None\n"
        "\n"
        "def _install(mod):\n"
        "    pkg = REMAP.get(mod, mod)\n"
        "    print(f'[AUTO-INSTALL] Missing {mod!r} — installing {pkg!r} ...', flush=True)\n"
        "    r = subprocess.run(\n"
        "        [sys.executable, '-m', 'pip', 'install', pkg, '-q'],\n"
        "        capture_output=True, text=True\n"
        "    )\n"
        "    if r.returncode == 0:\n"
        "        print(f'[AUTO-INSTALL] ✓ {pkg} installed!', flush=True)\n"
        "    else:\n"
        "        print(f'[AUTO-INSTALL] ✗ {pkg} failed:\\n{r.stderr.strip()}', flush=True)\n"
        "\n"
        "# ── Pre-check imports and install missing ones ──\n"
        "for _mod in _get_imports(SCRIPT):\n"
        "    if _is_stdlib(_mod): continue\n"
        "    if not _available(_mod):\n"
        "        _install(_mod)\n"
        "\n"
        "# ── Replace this process with the actual bot ──\n"
        "# os.execv is used so __file__, sys.argv, signals all work correctly\n"
        "os.execv(sys.executable, [sys.executable, SCRIPT])\n"
    )

    launcher_path.write_text(launcher_code)
    return str(launcher_path)

def _start_process(filepath: str, log_file: str) -> int:
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    launcher = _make_launcher(filepath)
    cwd = str(Path(filepath).parent)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    with open(log_file, "a", buffering=1) as lf:
        lf.write(f"\n{'='*50}\n")
        lf.write(f"  START  {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC\n")
        lf.write(f"  FILE   {filepath}\n")
        lf.write(f"  [AUTO-INSTALL enabled]\n")
        lf.write(f"{'='*50}\n")
        proc = subprocess.Popen(
            [sys.executable, launcher],
            stdout=lf, stderr=lf, text=True, env=env, cwd=cwd
        )
        return proc.pid

def _install_requirements(req_path: Path, log_file: str) -> bool:
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "a", buffering=1) as lf:
        lf.write(f"\n{'='*50}\n")
        lf.write(f"  INSTALL REQUIREMENTS\n")
        lf.write(f"  {req_path}\n")
        lf.write(f"{'='*50}\n")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(req_path)],
            stdout=lf, stderr=lf, text=True, timeout=180
        )
        if result.returncode == 0:
            lf.write("\n✓ Requirements installed successfully.\n")
            return True
        lf.write("\n✗ Installation failed — check logs.\n")
        return False

def _network_ok() -> tuple[bool, str]:
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "network_check.py")],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 1:
            return False, "No internet connection detected."
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "Network check timed out."
    except Exception:
        return True, ""  # assume OK if check fails

# ─────────────────── Auth routes ───────────────────

@app.route("/ping")
def ping():
    return {"status": "ok"}, 200

@app.get("/login")
def login():
    if current_user():
        return redirect(url_for("dashboard"))
    return render_template("login.html")

@app.post("/login")
def login_post():
    db = get_db()
    try:
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        u = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if not u or not check_password_hash(u.password_hash, password) or u.is_expired():
            flash("Invalid username or password.", "error")
            return redirect(url_for("login"))
        session["uid"]  = u.id
        session["role"] = u.role
        flash(f"Welcome back, {u.username}!", "success")
        return redirect(url_for("dashboard"))
    finally:
        db.close()

@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.get("/server/<identifier>")
def server_link(identifier):
    # The Telegram bot hands users a {panel}/server/<identifier> link.
    # This site has no per-server pages, so land them inside the panel.
    if session.get("uid"):
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))

# ─────────────────── Dashboard ───────────────────

@app.get("/")
@login_required
def dashboard():
    db = get_db()
    try:
        u       = current_user()
        bots    = db.query(Bot).filter(Bot.owner_id == u.id).order_by(Bot.created_at.desc()).all()
        contact = get_contact_link(db)
        reached = user_limit_reached(db, u)
        return render_template("dashboard.html",
            user=u, bots=bots, contact_link=contact,
            file_limit_reached=reached, now=datetime.utcnow())
    finally:
        db.close()

# ─────────────────── Logs ───────────────────

@app.get("/logs/<int:bot_id>")
@login_required
def logs(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            flash("Not found.", "error"); return redirect(url_for("dashboard"))
        log_text = ""
        if bot.logpath and Path(bot.logpath).exists():
            try:
                log_text = Path(bot.logpath).read_text(errors="ignore")[-200_000:]
            except Exception:
                log_text = "(unable to read logs)"
        return render_template("logs.html", bot=bot, logs=log_text)
    finally:
        db.close()

@app.get("/logs_raw/<int:bot_id>")
@login_required
def logs_raw(bot_id: int):
    """Return last N bytes of log as plain text (for live refresh)."""
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return "", 403
        text = ""
        if bot.logpath and Path(bot.logpath).exists():
            try:
                text = Path(bot.logpath).read_text(errors="ignore")[-50_000:]
            except Exception:
                text = ""
        from flask import Response
        return Response(text, mimetype="text/plain")
    finally:
        db.close()

@app.get("/download_logs/<int:bot_id>")
@login_required
def download_logs(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            flash("Not found.", "error"); return redirect(url_for("dashboard"))
        if bot.logpath and Path(bot.logpath).exists():
            return send_file(bot.logpath, as_attachment=True,
                             download_name=f"{bot.uid}.log")
        flash("No logs found.", "error")
        return redirect(url_for("logs", bot_id=bot.id))
    finally:
        db.close()

# ─────────────────── Upload ───────────────────

@app.get("/upload")
@login_required
def upload():
    u = current_user()
    return render_template("upload.html", user=u)

@app.post("/upload")
@login_required
def upload_post():
    db = get_db()
    try:
        u = current_user()
        if "file" not in request.files:
            flash("No file attached.", "error"); return redirect(url_for("upload"))
        f = request.files.get("file")
        if not f or not f.filename.strip():
            flash("No file selected.", "error"); return redirect(url_for("upload"))

        original_name = os.path.basename(f.filename)
        ext           = Path(original_name).suffix.lower()

        if ext not in ALLOWED_EXTS:
            flash("Only .py and .zip files allowed.", "error")
            return redirect(url_for("upload"))

        uid      = strong_uid()
        user_dir = UPLOAD_DIR / f"user_{u.id}" / uid
        user_dir.mkdir(parents=True, exist_ok=True)
        log_file = str(LOG_DIR / f"{uid}.log")

        # Bot limit (owner exempt): refuse the upload outright - bots
        # are never parked in a "pending" state.
        if u.role != "owner" and user_limit_reached(db, u):
            flash(f"Bot limit reached - you can have at most {BOT_LIMIT} bots. "
                  "Delete one to upload a new bot.", "error")
            return redirect(url_for("dashboard"))
        status = "stopped"

        if ext == ".py":
            # Direct .py upload
            dest = user_dir / original_name
            f.save(dest)
            bot = Bot(
                uid=uid, filename=original_name,
                filepath=str(dest), main_file=original_name,
                bot_dir=str(user_dir), owner_id=u.id,
                status=status, logpath=log_file,
                req_installed=False
            )
            db.add(bot); db.commit()

        elif ext == ".zip":
            # ZIP upload → extract → detect main
            zip_dest = user_dir / original_name
            f.save(zip_dest)
            extract_dir = user_dir / "src"
            extract_dir.mkdir(parents=True, exist_ok=True)
            try:
                extract_zip(zip_dest, extract_dir)
            except Exception as e:
                shutil.rmtree(user_dir, ignore_errors=True)
                flash(f"Failed to extract ZIP: {e}", "error")
                return redirect(url_for("upload"))

            py_files = sorted([
                str(p.relative_to(extract_dir))
                for p in extract_dir.rglob("*.py")
                if not any(part.startswith(".") or part == "__pycache__"
                           for part in p.parts)
            ])

            if not py_files:
                shutil.rmtree(user_dir, ignore_errors=True)
                flash("No .py files found in ZIP.", "error")
                return redirect(url_for("upload"))

            suggested = detect_main_file(py_files)
            main_path = extract_dir / suggested

            bot = Bot(
                uid=uid, filename=original_name,
                filepath=str(main_path), main_file=suggested,
                bot_dir=str(extract_dir), owner_id=u.id,
                status="setup",
                logpath=log_file, req_installed=False
            )
            db.add(bot); db.commit()

            # Redirect to setup page to let user confirm/change main file
            return redirect(url_for("setup_bot", bot_id=bot.id))

        flash(f"✓ Uploaded: {original_name}", "success")
        return redirect(url_for("dashboard"))
    finally:
        db.close()

# ─────────────────── Setup (main file selection) ───────────────────

@app.get("/setup/<int:bot_id>")
@login_required
def setup_bot(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            flash("Not found.", "error"); return redirect(url_for("dashboard"))
        if bot.status not in ("setup",):
            return redirect(url_for("dashboard"))

        bot_dir   = Path(bot.bot_dir) if bot.bot_dir else None
        py_files  = []
        has_req   = False
        req_count = 0

        if bot_dir and bot_dir.exists():
            py_files = sorted([
                str(p.relative_to(bot_dir))
                for p in bot_dir.rglob("*.py")
                if not any(part.startswith(".") or part == "__pycache__"
                           for part in p.parts)
            ])
            req = find_requirements_file(bot_dir)
            if req:
                has_req   = True
                req_count = len([l for l in req.read_text().splitlines()
                                 if l.strip() and not l.strip().startswith("#")])

        scored = sorted(py_files, key=score_py_file, reverse=True)
        return render_template("setup.html",
            bot=bot, py_files=scored,
            has_req=has_req, req_count=req_count)
    finally:
        db.close()

@app.post("/setup/<int:bot_id>")
@login_required
def setup_bot_post(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            flash("Not found.", "error"); return redirect(url_for("dashboard"))

        chosen = request.form.get("main_file", "").strip()
        bot_dir = Path(bot.bot_dir) if bot.bot_dir else None

        if bot_dir and chosen:
            main_path = bot_dir / chosen
            if main_path.exists() and main_path.suffix == ".py":
                bot.main_file = chosen
                bot.filepath  = str(main_path)
            else:
                flash("Invalid file selection.", "error")
                return redirect(url_for("setup_bot", bot_id=bot.id))
        
        bot.status = "stopped"
        db.commit()
        flash(f"✓ Setup complete! Entry point: {bot.main_file}", "success")
        return redirect(url_for("dashboard"))
    finally:
        db.close()

# ─────────────────── Install requirements ───────────────────

@app.post("/install_req/<int:bot_id>")
@login_required
def install_req(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False, msg="Not found.")
        
        bot_dir = Path(bot.bot_dir) if bot.bot_dir else Path(bot.filepath).parent
        req     = find_requirements_file(bot_dir)
        if not req:
            return jsonify(ok=False, msg="No requirements.txt found.")

        log_file = bot.logpath or str(LOG_DIR / f"{bot.uid}.log")
        bot.logpath = log_file
        db.commit()

        ok = _install_requirements(req, log_file)
        if ok:
            bot.req_installed = True
            db.commit()
            return jsonify(ok=True, msg="Requirements installed successfully.")
        return jsonify(ok=False, msg="Installation failed — check logs for details.")
    except Exception as e:
        return jsonify(ok=False, msg=str(e))
    finally:
        db.close()

# ─────────────────── Start / Stop / Restart ───────────────────

@app.post("/start/<int:bot_id>")
@login_required
def start_bot(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False, msg="Not found.")
        if bot.status == "pending":
            return jsonify(ok=False, msg="Bot is pending owner approval.")
        if bot.status == "setup":
            return jsonify(ok=False, msg="Complete setup first.")
        if bot.status == "running":
            return jsonify(ok=True, msg="Already running.")

        path = Path(bot.filepath)
        if not path.exists():
            return jsonify(ok=False, msg="Entry point file missing on server.")

        ok, err = _network_ok()
        if not ok:
            return jsonify(ok=False, msg=f"Network issue: {err}")

        log_file    = bot.logpath or str(LOG_DIR / f"{bot.uid}.log")
        bot.logpath = log_file
        pid         = _start_process(str(path), log_file)
        bot.pid        = pid
        bot.status     = "running"
        bot.started_at = datetime.utcnow()
        db.commit()
        return jsonify(ok=True, pid=pid)
    except Exception as e:
        return jsonify(ok=False, msg=str(e))
    finally:
        db.close()

@app.post("/stop/<int:bot_id>")
@login_required
def stop_bot(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False, msg="Not found.")
        if bot.status in ("pending", "setup"):
            return jsonify(ok=False, msg="Cannot stop this bot.")
        if bot.pid:
            _kill_pid(bot.pid)
        bot.pid    = None
        bot.status = "stopped"
        db.commit()
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, msg=str(e))
    finally:
        db.close()

@app.post("/restart/<int:bot_id>")
@login_required
def restart_bot(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False, msg="Not found.")
        if bot.status in ("pending", "setup"):
            return jsonify(ok=False, msg="Cannot restart this bot.")

        path = Path(bot.filepath)
        if not path.exists():
            return jsonify(ok=False, msg="Entry point file missing.")

        # Stop
        if bot.pid:
            _kill_pid(bot.pid)
        time.sleep(0.8)

        # Check network
        ok, err = _network_ok()
        if not ok:
            bot.pid = None; bot.status = "stopped"; db.commit()
            return jsonify(ok=False, msg=f"Network issue: {err}")

        # Start
        log_file = bot.logpath or str(LOG_DIR / f"{bot.uid}.log")
        pid = _start_process(str(path), log_file)
        bot.pid           = pid
        bot.status        = "running"
        bot.started_at    = datetime.utcnow()
        bot.restart_count = (bot.restart_count or 0) + 1
        db.commit()
        return jsonify(ok=True, pid=pid, restarts=bot.restart_count)
    except Exception as e:
        return jsonify(ok=False, msg=str(e))
    finally:
        db.close()

@app.get("/bot_status/<int:bot_id>")
@login_required
def bot_status(bot_id: int):
    """JSON status for live dashboard updates."""
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False)
        return jsonify(
            ok=True,
            status=bot.status,
            uptime=bot.uptime_str(),
            pid=bot.pid,
            restarts=bot.restart_count or 0
        )
    finally:
        db.close()

@app.post("/delete/<int:bot_id>")
@login_required
def delete_bot(bot_id: int):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or bot.owner_id != u.id:
            return jsonify(ok=False, msg="Not found.")
        if bot.pid:
            try: _kill_pid(bot.pid)
            except Exception: pass

        # Remove files
        try:
            if bot.bot_dir and Path(bot.bot_dir).exists():
                shutil.rmtree(Path(bot.bot_dir).parent, ignore_errors=True)
            elif bot.filepath and Path(bot.filepath).exists():
                Path(bot.filepath).unlink(missing_ok=True)
        except Exception: pass
        try:
            if bot.logpath and Path(bot.logpath).exists():
                Path(bot.logpath).unlink(missing_ok=True)
        except Exception: pass

        db.delete(bot); db.commit()
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, msg=str(e))
    finally:
        db.close()

# ─────────────────── My Files ───────────────────

def _fmt_size(b: int) -> str:
    if b >= 1_073_741_824: return f"{b/1_073_741_824:.1f} GB"
    if b >= 1_048_576:     return f"{b/1_048_576:.1f} MB"
    if b >= 1024:          return f"{b/1024:.1f} KB"
    return f"{b} B"

def _scan_bot_files(bot) -> list[dict]:
    """Return all files for a bot, grouped as a list of dicts."""
    results = []
    skip_prefixes = ("_sc_launcher_",)
    skip_dirs     = {"__pycache__", ".git", ".idea", "node_modules"}

    def should_skip(p: Path) -> bool:
        if p.name.startswith(skip_prefixes): return True
        if any(part in skip_dirs for part in p.parts): return True
        return False

    bot_dir = Path(bot.bot_dir) if bot.bot_dir else None

    if bot_dir and bot_dir.exists():
        for f in sorted(bot_dir.rglob("*")):
            if not f.is_file() or should_skip(f): continue
            try:
                stat = f.stat()
                rel  = str(f.relative_to(bot_dir))
                results.append({
                    "name":     f.name,
                    "rel":      rel,
                    "size":     stat.st_size,
                    "size_str": _fmt_size(stat.st_size),
                    "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "ext":      f.suffix.lower(),
                    "is_main":  (rel == bot.main_file or f.name == (bot.main_file or "").split("/")[-1]),
                })
            except Exception:
                pass
    else:
        # Single .py bot — no bot_dir
        p = Path(bot.filepath)
        if p.exists() and not should_skip(p):
            try:
                stat = p.stat()
                results.append({
                    "name":     p.name,
                    "rel":      p.name,
                    "size":     stat.st_size,
                    "size_str": _fmt_size(stat.st_size),
                    "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "ext":      p.suffix.lower(),
                    "is_main":  True,
                })
            except Exception:
                pass
    return results

@app.get("/my_files")
@login_required
def my_files():
    db = get_db()
    try:
        u    = current_user()
        bots = db.query(Bot).filter(Bot.owner_id == u.id).order_by(Bot.created_at.desc()).all()
        folders = []
        total_size = 0
        for bot in bots:
            files = _scan_bot_files(bot)
            folder_size = sum(f["size"] for f in files)
            total_size += folder_size
            folders.append({
                "bot":         bot,
                "files":       files,
                "file_count":  len(files),
                "folder_size": _fmt_size(folder_size),
                "folder_bytes": folder_size,
            })
        return render_template("my_files.html", user=u,
                               folders=folders,
                               total_size=_fmt_size(total_size),
                               total_files=sum(f["file_count"] for f in folders))
    finally:
        db.close()

@app.get("/download_file/<int:bot_id>/<path:rel_path>")
@login_required
def download_file(bot_id: int, rel_path: str):
    db = get_db()
    try:
        u   = current_user()
        bot = db.get(Bot, bot_id)
        if not bot or (bot.owner_id != u.id and u.role != "owner"):
            return "Not found", 404

        # Resolve safe path
        base = Path(bot.bot_dir) if bot.bot_dir else Path(bot.filepath).parent
        target = (base / rel_path).resolve()

        # Security: must stay within base
        try:
            target.relative_to(base.resolve())
        except ValueError:
            return "Forbidden", 403

        if not target.exists() or not target.is_file():
            return "File not found", 404

        return send_file(str(target), as_attachment=True, download_name=target.name)
    finally:
        db.close()


# ─────────────────── Run ───────────────────

def _free_port(port: int):
    """Kill any process holding this port — works on Termux/Linux without lsof."""
    killed = False

    # Method 1: /proc/net/tcp (works on Android/Termux)
    try:
        hex_port = format(port, '04X')
        with open('/proc/net/tcp') as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if len(parts) < 10:
                    continue
                local = parts[1]
                lport = int(local.split(':')[1], 16)
                if lport == port:
                    inode = parts[9]
                    # Find PID owning this inode
                    for pid_dir in Path('/proc').iterdir():
                        if not pid_dir.name.isdigit():
                            continue
                        try:
                            fd_dir = pid_dir / 'fd'
                            for fd in fd_dir.iterdir():
                                if fd.is_symlink():
                                    link = str(fd.resolve())
                                    if f'socket:[{inode}]' in link:
                                        pid = int(pid_dir.name)
                                        if pid != os.getpid():
                                            os.kill(pid, signal.SIGKILL)
                                            print(f"[STARTUP] Killed PID {pid} on port {port}")
                                            killed = True
                        except Exception:
                            pass
    except Exception:
        pass

    # Method 2: fuser fallback
    if not killed:
        try:
            subprocess.run(["fuser", "-k", f"{port}/tcp"],
                           capture_output=True, timeout=3)
        except Exception:
            pass

    # Method 3: ss fallback
    if not killed:
        try:
            r = subprocess.run(["ss", "-tlnp", f"sport = :{port}"],
                               capture_output=True, text=True, timeout=3)
            for line in r.stdout.splitlines():
                if 'pid=' in line:
                    import re
                    m = re.search(r'pid=(\d+)', line)
                    if m:
                        pid = int(m.group(1))
                        if pid != os.getpid():
                            os.kill(pid, signal.SIGKILL)
                            print(f"[STARTUP] Killed PID {pid} via ss")
        except Exception:
            pass


# ─────────────────── Expiry sweeper ───────────────────

def stop_expired_users_bots():
    """Stop every running bot owned by an expired non-owner user."""
    db = get_db()
    try:
        users = db.query(User).filter(User.role != "owner").all()
        for u in users:
            if not u.is_expired():
                continue
            bots = db.query(Bot).filter(
                Bot.owner_id == u.id, Bot.status == "running").all()
            for bot in bots:
                if bot.pid:
                    try:
                        _kill_pid(bot.pid)
                    except Exception:
                        pass
                bot.pid = None
                bot.status = "stopped"
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()

def _expiry_sweeper_loop():
    while True:
        try:
            stop_expired_users_bots()
        except Exception:
            pass
        time.sleep(3600)

threading.Thread(target=_expiry_sweeper_loop, daemon=True).start()

# ─────────────────── Bot application API ───────────────────
# Pterodactyl-compatible Application API used by the Telegram bot
# (botapi.py). Invisible plumbing - not a website feature.
import botapi as _botapi
_botapi.init(SessionLocal)
app.register_blueprint(_botapi.bp)

if __name__ == "__main__":
    import socketserver as _ss
    _ss.TCPServer.allow_reuse_address = True   # SO_REUSEADDR — instant port reuse

    PORT = int(os.environ.get("PORT", 5029))
    _free_port(PORT)

    import time as _t; _t.sleep(0.3)
    print(f"[STARTUP] ZVXAY Panel → http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
