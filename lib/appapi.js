'use strict';

const express = require('express');
const crypto = require('crypto');
const { LOCATIONS, NESTS, EGGS } = require('./store');
const lifecycle = require('./lifecycle');

/* ------------------------------------------------------------------ *
 * Pterodactyl-compatible Application API.
 *
 * The existing Telegram bot talks to this surface with ZERO changes:
 *   GET    /api/application/locations
 *   POST   /api/application/users
 *   GET    /api/application/nests
 *   GET    /api/application/nests/:id/eggs
 *   POST   /api/application/servers
 *   DELETE /api/application/users/:id
 *
 * Single-object responses carry `attributes` at the top level and list
 * responses carry `data` + `meta.pagination`, exactly like Pterodactyl
 * (the bot reads res.data.attributes and res.data.data respectively).
 * ------------------------------------------------------------------ */

function pteroError(res, status, code, detail) {
  return res.status(status).json({ errors: [{ code, status: String(status), detail }] });
}

function paginate(req, items) {
  const perPage = Math.max(1, Math.min(1000, parseInt(req.query.per_page, 10) || 50));
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.max(1, Math.min(totalPages, parseInt(req.query.page, 10) || 1));
  const slice = items.slice((page - 1) * perPage, page * perPage);
  return {
    slice,
    meta: {
      pagination: {
        total: items.length,
        count: slice.length,
        per_page: perPage,
        current_page: page,
        total_pages: totalPages,
        links: {},
      },
    },
  };
}

function listResponse(req, res, items) {
  const { slice, meta } = paginate(req, items);
  return res.json({ object: 'list', data: slice, meta });
}

function userAttributes(user) {
  return {
    id: user.id,
    external_id: null,
    uuid: crypto.createHash('md5').update(`user-${user.id}`).digest('hex'),
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    language: 'en',
    root_admin: !!user.is_admin,
    '2fa': false,
    created_at: user.created_at,
    updated_at: user.created_at,
  };
}

function serverAttributes(server) {
  return {
    id: server.id,
    external_id: null,
    uuid: crypto.createHash('md5').update(`server-${server.identifier}`).digest('hex'),
    identifier: server.identifier,
    name: server.name,
    description: '',
    status: server.status === 'running' ? null : 'offline',
    suspended: false,
    limits: server.limits,
    feature_limits: server.feature_limits,
    user: server.user_id,
    node: 1,
    allocation: 1,
    nest: server.nest_id,
    egg: server.egg_id,
    container: {
      startup_command: server.startup_raw,
      environment: server.environment,
      image: server.docker_image,
      installed: true,
    },
    created_at: server.created_at,
    updated_at: server.created_at,
  };
}

function createAppApi(store, engine) {
  const router = express.Router();

  // Bearer auth against the stored application API key(s).
  router.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!store.isValidAppKey(key)) {
      return pteroError(res, 401, 'AuthenticationException', 'An authentication error occurred while processing your request.');
    }
    next();
  });

  router.get('/locations', (req, res) => {
    const items = LOCATIONS.map((l) => ({
      object: 'location',
      attributes: { id: l.id, short: l.short, long: l.long, created_at: null, updated_at: null },
    }));
    return listResponse(req, res, items);
  });

  router.post('/users', (req, res) => {
    const { email, username, first_name, last_name, password } = req.body || {};
    if (!email || !username || !password) {
      return pteroError(res, 422, 'ValidationException', 'The email, username and password fields are required.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return pteroError(res, 422, 'ValidationException', 'The email must be a valid email address.');
    }
    if (!/^[a-zA-Z0-9_\-.]{3,32}$/.test(String(username))) {
      return pteroError(res, 422, 'ValidationException', 'The username may only contain letters, numbers, dashes, underscores and dots (3-32 characters).');
    }
    if (store.findUserByUsername(username)) {
      return pteroError(res, 422, 'ValidationException', 'The username has already been taken.');
    }
    if (store.findUserByEmail(email)) {
      return pteroError(res, 422, 'ValidationException', 'The email has already been taken.');
    }
    const user = store.createUser({
      email: String(email),
      username: String(username),
      first_name: first_name || String(username),
      last_name: last_name || '',
      password: String(password),
    });
    return res.status(201).json({ object: 'user', attributes: userAttributes(user) });
  });

  router.get('/users/:id', (req, res) => {
    const user = store.findUserById(req.params.id);
    if (!user) return pteroError(res, 404, 'NotFoundHttpException', 'The requested resource could not be found.');
    return res.json({ object: 'user', attributes: userAttributes(user) });
  });

  router.delete('/users/:id', async (req, res) => {
    const user = store.findUserById(req.params.id);
    if (!user) return pteroError(res, 404, 'NotFoundHttpException', 'The requested resource could not be found.');
    if (user.is_admin) return pteroError(res, 422, 'ValidationException', 'The admin account cannot be deleted.');
    // Deleting a user also deletes (and stops) all of their servers.
    for (const server of [...store.serversOfUser(user.id)]) {
      await engine.deleteServer(server.identifier);
    }
    store.deleteUser(user.id);
    return res.status(204).send();
  });

  router.get('/nests', (req, res) => {
    const items = NESTS.map((n) => ({
      object: 'nest',
      attributes: { id: n.id, uuid: crypto.createHash('md5').update(`nest-${n.id}`).digest('hex'), author: n.author, name: n.name, description: n.description, created_at: null, updated_at: null },
    }));
    return listResponse(req, res, items);
  });

  router.get('/nests/:id/eggs', (req, res) => {
    const nest = NESTS.find((n) => n.id === Number(req.params.id));
    if (!nest) return pteroError(res, 404, 'NotFoundHttpException', 'The requested resource could not be found.');
    const items = EGGS.filter((e) => e.nest === nest.id).map((e) => ({
      object: 'egg',
      attributes: {
        id: e.id,
        uuid: crypto.createHash('md5').update(`egg-${e.id}`).digest('hex'),
        nest: e.nest,
        author: 'zvxay',
        name: e.name,
        description: e.description,
        docker_image: e.docker_image,
        startup: e.startup,
        created_at: null,
        updated_at: null,
      },
    }));
    return listResponse(req, res, items);
  });

  router.post('/servers', (req, res) => {
    const body = req.body || {};
    const { name, user, egg } = body;
    if (!name || user === undefined || egg === undefined) {
      return pteroError(res, 422, 'ValidationException', 'The name, user and egg fields are required.');
    }
    const owner = store.findUserById(user);
    if (!owner) return pteroError(res, 422, 'ValidationException', 'The selected user is invalid.');
    if (owner.status === 'banned') return pteroError(res, 422, 'ValidationException', 'This user is banned.');
    const eggDef = EGGS.find((e) => e.id === Number(egg));
    if (!eggDef) return pteroError(res, 422, 'ValidationException', 'The selected egg is invalid.');
    lifecycle.applyExpiry(store, engine, owner);
    if (owner.status === 'expired') {
      return pteroError(res, 422, 'ValidationException', 'This user account has expired.');
    }
    // Per-user cap: at most 2 bots per account (admins exempt).
    if (!owner.is_admin && store.serversOfUser(owner.id).length >= 2) {
      return pteroError(res, 422, 'TooManyServersException', 'This user has reached the maximum of 2 bots.');
    }

    const environment = { ...eggDef.env_defaults, ...(body.environment || {}) };
    const server = store.createServer({
      identifier: crypto.randomBytes(4).toString('hex'),
      user_id: owner.id,
      name: String(name),
      egg: eggDef.key,
      egg_id: eggDef.id,
      nest_id: eggDef.nest,
      docker_image: body.docker_image || eggDef.docker_image,
      startup_raw: body.startup || eggDef.startup,
      environment,
      limits: body.limits || { memory: 0, swap: 0, disk: 0, io: 500, cpu: 0 },
      feature_limits: body.feature_limits || { databases: 1, allocations: 1, backups: 1 },
      status: 'offline',
      created_at: new Date().toISOString(),
    });
    return res.status(201).json({ object: 'server', attributes: serverAttributes(server) });
  });

  return router;
}

module.exports = { createAppApi, userAttributes, serverAttributes };
