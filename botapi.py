#!/usr/bin/env python3
"""Pterodactyl-compatible Application API for the Telegram bot.

Invisible plumbing: the Crittix bot creates panel accounts (POST /users)
and records the servers it provisions (POST /servers) through these
endpoints. Auth is a single Bearer key taken from the APP_API_KEY
environment variable. Panel accounts created here log in on the website
with the username/password the bot issued; they expire after 10 days.

API-created "servers" are bookkeeping records only (stored as JSON in
KeyValue rows) - real hosted bots are created through the website's own
Upload page, never from here.
"""
import hmac
import json
import os
import signal
import time
import uuid
from datetime import datetime, date, timedelta

from flask import Blueprint, request, jsonify
from sqlalchemy import select
from werkzeug.security import generate_password_hash

from models import User, Bot, KeyValue

bp = Blueprint("botapi", __name__)

_SessionLocal = None
_TS = datetime.utcnow().isoformat() + "Z"
_ACCOUNT_VALIDITY_DAYS = 10


def init(session_factory):
    """app.py hands us its scoped session factory at registration."""
    global _SessionLocal
    _SessionLocal = session_factory


# ─────────────────── helpers ───────────────────

def _db():
    return _SessionLocal()


def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


def _error(status, code, detail):
    return jsonify({"errors": [{"code": code, "status": str(status), "detail": detail}]}), status


def _list(items):
    n = len(items)
    return jsonify({
        "object": "list",
        "data": items,
        "meta": {"pagination": {"total": n, "count": n, "per_page": 50,
                                "current_page": 1, "total_pages": 1, "links": {}}},
    })


def _kv_get(db, key):
    kv = db.execute(select(KeyValue).where(KeyValue.k == key)).scalar_one_or_none()
    return kv.v if kv else None


def _kv_set(db, key, value):
    kv = db.execute(select(KeyValue).where(KeyValue.k == key)).scalar_one_or_none()
    if kv is None:
        db.add(KeyValue(k=key, v=value))
    else:
        kv.v = value


def _kv_del(db, key):
    kv = db.execute(select(KeyValue).where(KeyValue.k == key)).scalar_one_or_none()
    if kv is not None:
        db.delete(kv)


def _kill_pid(pid):
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.5)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    except ProcessLookupError:
        pass
    except Exception:
        pass


@bp.before_request
def _require_api_key():
    expected = os.environ.get("APP_API_KEY") or ""
    given = request.headers.get("Authorization") or ""
    ok = bool(expected) and hmac.compare_digest(
        given.encode("utf-8"), ("Bearer " + expected).encode("utf-8"))
    if not ok:
        return _error(401, "AuthenticationException", "Invalid application API key.")
    return None


# ─────────────────── locations / nests / eggs ───────────────────

@bp.get("/api/application/locations")
def locations():
    return _list([{
        "object": "location",
        "attributes": {"id": 1, "short": "main", "long": "ZVXAY Panel",
                       "created_at": _TS, "updated_at": _TS},
    }])


@bp.get("/api/application/nests")
def nests():
    return _list([{
        "object": "nest",
        "attributes": {"id": 1, "uuid": str(uuid.uuid5(uuid.NAMESPACE_DNS, "zvxay-nest-1")),
                       "author": "zvxay", "name": "Default", "description": "",
                       "created_at": _TS, "updated_at": _TS},
    }])


_EGGS = [
    {
        "id": 1,
        "name": "NODE JS",
        "description": "Node.js bot server",
        "docker_image": "ghcr.io/parkervcp/yolks:nodejs_22",
        "startup": (
            'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; '
            'if [[ ! -z ${NODE_PACKAGES} ]]; then npm install ${NODE_PACKAGES}; fi; '
            'if [ -f package.json ]; then npm install; fi; ${CMD_RUN}'
        ),
    },
    {
        "id": 2,
        "name": "Python Engine",
        "description": "Python bot server",
        "docker_image": "ghcr.io/parkervcp/yolks:python_3.12",
        "startup": (
            'if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; '
            'if [[ ! -z "{{PY_PACKAGES}}" ]]; then pip install -U --prefix .local {{PY_PACKAGES}}; fi; '
            'if [[ -f ${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r ${REQUIREMENTS_FILE}; fi; '
            'python3 {{PY_FILE}}'
        ),
    },
]


def _egg_shape(e):
    return {
        "object": "egg",
        "attributes": {
            "id": e["id"],
            "uuid": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"zvxay-egg-{e['id']}")),
            "nest": 1,
            "author": "zvxay",
            "name": e["name"],
            "description": e["description"],
            "docker_image": e["docker_image"],
            "docker_images": {e["name"]: e["docker_image"]},
            "startup": e["startup"],
            "config": {
                "files": {},
                "startup": {"done": "Ready"},
                "stop": {"type": "command", "value": "^C"},
                "logs": {"custom": False, "location": "logs/latest.log"},
            },
            "script": {
                "privileged": False,
                "install": None,
                "entry": "bash",
                "container": "ghcr.io/parkervcp/installers:debian",
                "extends": None,
            },
            "created_at": _TS,
            "updated_at": _TS,
        },
    }


@bp.get("/api/application/nests/<int:nest_id>/eggs")
def eggs(nest_id):
    if nest_id != 1:
        return _error(404, "NotFoundHttpException", "The requested nest could not be found.")
    return _list([_egg_shape(e) for e in _EGGS])


# ─────────────────── users ───────────────────

def _user_shape(db, u):
    email = _kv_get(db, f"email:{u.id}") or ""
    first_name, last_name, user_uuid = u.username, "", None
    raw = _kv_get(db, f"apiuser:{u.id}")
    if raw:
        try:
            extra = json.loads(raw)
            first_name = extra.get("first_name") or u.username
            last_name = extra.get("last_name") or ""
            user_uuid = extra.get("uuid")
        except Exception:
            pass
    if not user_uuid:
        user_uuid = uuid.uuid5(uuid.NAMESPACE_DNS, f"zvxay-user-{u.id}").hex
    created = (u.created_at.isoformat() + "Z") if u.created_at else _TS
    return {
        "object": "user",
        "attributes": {
            "id": u.id,
            "external_id": None,
            "uuid": user_uuid,
            "username": u.username,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "language": "en",
            "root_admin": bool(u.role == "owner"),
            "2fa": False,
            "created_at": created,
            "updated_at": created,
        },
    }


@bp.post("/api/application/users")
def create_user():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return _error(422, "ValidationException", "The username and password fields are required.")
    db = _db()
    try:
        exists = db.execute(
            select(User).where(User.username == username)).scalar_one_or_none()
        if exists:
            return _error(422, "ValidationException", "The username has already been taken.")
        u = User(
            username=username,
            password_hash=generate_password_hash(password),
            role="user",
            approved=True,
            expiry=date.today() + timedelta(days=_ACCOUNT_VALIDITY_DAYS),
        )
        db.add(u)
        db.commit()
        _kv_set(db, f"email:{u.id}", body.get("email") or "")
        _kv_set(db, f"apiuser:{u.id}", json.dumps({
            "first_name": body.get("first_name") or username,
            "last_name": body.get("last_name") or "",
            "uuid": uuid.uuid4().hex,
        }))
        db.commit()
        return jsonify(_user_shape(db, u)), 201
    finally:
        db.close()


@bp.get("/api/application/users/<int:user_id>")
def get_user(user_id):
    db = _db()
    try:
        u = db.get(User, user_id)
        if not u:
            return _error(404, "NotFoundHttpException", "The requested user could not be found.")
        return jsonify(_user_shape(db, u))
    finally:
        db.close()


@bp.delete("/api/application/users/<int:user_id>")
def delete_user(user_id):
    db = _db()
    try:
        u = db.get(User, user_id)
        if not u:
            return _error(404, "NotFoundHttpException", "The requested user could not be found.")
        for bot in db.query(Bot).filter(Bot.owner_id == u.id).all():
            if bot.pid:
                _kill_pid(bot.pid)
            db.delete(bot)
        for rec in _all_server_records(db):
            if rec.get("user_id") == u.id:
                _kv_del(db, f"server:{rec.get('identifier')}")
        _kv_del(db, f"email:{u.id}")
        _kv_del(db, f"apiuser:{u.id}")
        db.delete(u)
        db.commit()
        return "", 204
    finally:
        db.close()


# ─────────────────── servers (bookkeeping records) ───────────────────

def _all_server_records(db):
    recs = []
    rows = db.execute(select(KeyValue).where(KeyValue.k.like("server:%"))).scalars().all()
    for kv in rows:
        if kv.k == "server:counter":
            continue
        try:
            recs.append(json.loads(kv.v or "{}"))
        except Exception:
            pass
    recs.sort(key=lambda r: r.get("id", 0))
    return recs


def _server_shape(rec):
    return {
        "object": "server",
        "attributes": {
            "id": rec["id"],
            "external_id": None,
            "uuid": rec["uuid"],
            "identifier": rec["identifier"],
            "name": rec["name"],
            "description": "",
            "limits": rec.get("limits") or {},
            "feature_limits": rec.get("feature_limits") or {},
            "egg": rec["egg"],
            "nest": 1,
            "node": 1,
            "allocation": 1,
            "server_owner_id": rec["user_id"],
            "status": None,
            "created_at": rec["created_at"],
            "updated_at": rec["created_at"],
        },
    }


@bp.post("/api/application/servers")
def create_server():
    body = request.get_json(silent=True) or {}
    db = _db()
    try:
        owner = db.get(User, body.get("user")) if body.get("user") is not None else None
        if not owner:
            return _error(404, "NotFoundHttpException", "The requested user could not be found.")
        raw = _kv_get(db, "server:counter")
        next_id = (int(raw) if raw and str(raw).isdigit() else 0) + 1
        identifier = uuid.uuid4().hex[:8]
        while _kv_get(db, f"server:{identifier}") is not None:
            identifier = uuid.uuid4().hex[:8]
        rec = {
            "id": next_id,
            "user_id": owner.id,
            "name": body.get("name") or "",
            "egg": body.get("egg"),
            "identifier": identifier,
            "uuid": str(uuid.uuid4()),
            "limits": body.get("limits") or {},
            "feature_limits": body.get("feature_limits") or {},
            "created_at": _now_iso(),
        }
        _kv_set(db, "server:counter", str(next_id))
        _kv_set(db, f"server:{identifier}", json.dumps(rec))
        db.commit()
        return jsonify(_server_shape(rec)), 201
    finally:
        db.close()


@bp.get("/api/application/servers")
def list_servers():
    db = _db()
    try:
        return _list([_server_shape(r) for r in _all_server_records(db)])
    finally:
        db.close()


@bp.get("/api/application/servers/<server_id>")
def get_server(server_id):
    db = _db()
    try:
        for rec in _all_server_records(db):
            if str(rec.get("id")) == str(server_id) or rec.get("identifier") == server_id:
                return jsonify(_server_shape(rec))
        return _error(404, "NotFoundHttpException", "The requested server could not be found.")
    finally:
        db.close()
