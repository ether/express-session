// @ts-nocheck
/*!
 * express-session
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

import Buffer from 'safe-buffer';
import cookie from 'cookie'
import crypto from 'crypto'
import deprecate from 'depd'
import onHeaders from 'on-headers'
import {debug} from 'debug';

import parseUrl from 'parseurl'
import signature from 'cookie-signature'
import Cookie, {Options, Request} from './session/cookie'
import MemoryStore from './session/memory'
import Session from "./session/session";
import uid from 'uid-safe'
import {Express} from "express";
// environment

const env = process.env.NODE_ENV;

/**
 * Expose the middleware.
 */
/**
 * Warning message for `MemoryStore` usage in production.
 * @private
 */

const warning = 'Warning: connect.session() MemoryStore is not\n'
  + 'designed for a production environment, as it will leak\n'
  + 'memory, and will not scale past a single process.';

/**
 * Node.js 0.8+ async implementation.
 * @private
 */
type DerefFunctionType = (...args: any) => void

/* istanbul ignore next */
const defer:DerefFunctionType = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn){ process.nextTick(fn.bind.apply(fn, arguments)) }

/**
 * Setup session store with the given `options`.
 *
 * @param {Object} [options]
 * @param {Object} [options.cookie] Options for cookie
 * @param {Function} [options.genid]
 * @param {String} [options.name=connect.sid] Session ID cookie name
 * @param {Boolean} [options.proxy]
 * @param {Boolean} [options.propagateTouch] Whether session.touch() should call store.touch()
 * @param {Boolean} [options.resave] Resave unmodified sessions back to the store
 * @param {Boolean} [options.rolling] Enable/disable rolling session expiration
 * @param {Boolean} [options.saveUninitialized] Save uninitialized sessions to the store
 * @param {String|Array} [options.secret] Secret for signing session ID
 * @param {Object} [options.store=MemoryStore] Session store
 * @param {String} [options.unset]
 * @return {Function} middleware
 * @public
 */

export const session = (options:Options): Express=> {
  const opts = options || {}


  // get the cookie options
  const cookieOptions = opts.cookie || {}

  // get the session id generate function
  const generateId = opts.genid || generateSessionId
  // get the session cookie name
  const name = opts.name || opts.key || 'connect.sid'

  let propagateTouch = opts.propagateTouch;
  if (!propagateTouch) {
    deprecate('falsy propagateTouch option; set to true');
  }

  // get the session store
  const store = opts.store || new MemoryStore()

  // get the trust proxy setting
  const trustProxy = opts.proxy

  // get the resave session option
  let resaveSession = opts.resave;

  // get the rolling session option
  const rollingSessions = Boolean(opts.rolling)

  // get the save uninitialized session option
  let saveUninitializedSession = opts.saveUninitialized

  // get the cookie signing secret
  let secret = opts.secret

  if (typeof generateId !== 'function') {
    throw new TypeError('genid option must be a function');
  }

  if (resaveSession === undefined) {
    deprecate('undefined resave option; provide resave option');
    resaveSession = true;
  }

  if (saveUninitializedSession === undefined) {
    deprecate('undefined saveUninitialized option; provide saveUninitialized option');
    saveUninitializedSession = true;
  }

  if (opts.unset && opts.unset !== 'destroy' && opts.unset !== 'keep') {
    throw new TypeError('unset option must be "destroy" or "keep"');
  }

  // TODO: switch to "destroy" on next major
  const unsetDestroy = opts.unset === 'destroy'

  if (Array.isArray(secret) && secret.length === 0) {
    throw new TypeError('secret option array must contain one or more strings');
  }

  if (secret && !Array.isArray(secret)) {
    secret = [secret];
  }

  if (!secret) {
    deprecate('req.secret; provide secret option');
  }

  // notify user that this store is not
  // meant for a production environment
  /* istanbul ignore next: not tested */
  if (env === 'production') {
    console.warn(warning);
  }

  // generates the new session
  store.generate = (req:Request)=>{
    req.sessionID = generateId(req);
    req.session = new Session(req);
    req.session.cookie = new Cookie(cookieOptions);

    if (cookieOptions.secure === 'auto') {
      req.session.cookie.secure = issecure(req, trustProxy);
    }
  }

  const storeImplementsTouch = typeof store.touch === 'function';

  // register event listeners for the store to track readiness
  let storeReady = true
  store.on('disconnect', function ondisconnect() {
    storeReady = false
  })
  store.on('connect', function onconnect() {
    storeReady = true
  })

  return (req:Request, res:any, next:Function)=> {
    // self-awareness
    if (req.session) {
      next()
      return
    }

    // Handle connection as if there is no session if
    // the store has temporarily disconnected etc
    if (!storeReady) {
      debug.log('store is disconnected')
      next()
      return
    }

    // pathname mismatch
    const originalPath = parseUrl.original(req).pathname || '/'
    if (originalPath.indexOf(cookieOptions.path || '/') !== 0)
      return next();

    // ensure a secret is available or bail
    //FIXME It has no secret
    if (!secret && !req.secret) {
      next(new Error('secret option required for sessions'));
      return;
    }


    // backwards compatibility for signed cookies
    // req.secret is passed from the cookie parser middleware
    const secrets = secret || [req.secret];

    let originalHash: string;
    let originalId: string | undefined;
    let savedHash: string;
    let touched = false
    let touchedStore = false;

    function autoTouch() {
      if (touched) return;
      // For legacy reasons, auto-touch does not touch the session in the store. That is done later.
      let backup = propagateTouch;
      propagateTouch = false;
      try {
        req.session!.touch();
      } finally {
        propagateTouch = backup;
      }
    }

    // expose store
    req.sessionStore = store;

    // get the session ID from the cookie
    const cookieId = req.sessionID = getcookie(req, name, secrets);

    // set-cookie
    onHeaders(res, ()=>{
      if (!req.session) {
        debug.log('no session');
        return
      }

      if (!shouldSetCookie(req)) {
        return
      }

      // only send secure cookies via https
      if (req.session.cookie.secure && !issecure(req, trustProxy)) {
        debug.log('not secured');
        return
      }

      autoTouch();

      // set cookie
      setcookie(res, name, req.sessionID, secrets[0], req.session.cookie.data);
    })

    // proxy end() to commit the session
    const _end = res.end;
    const _write = res.write;
    let ended = false;
    res.end = (chunk: string | any[] | null|Buffer.Buffer, encoding: undefined)=> {
      if (ended) {
        return false;
      }

      ended = true;

      let ret: boolean;
      let sync = true;

      const writeend = ()=> {
        if (sync) {
          ret = _end.call(res, chunk, encoding);
          sync = false;
          return;
        }

        _end.call(res);
      }

       const writetop = ()=> {
        if (!sync) {
          return ret;
        }

        if (!res._header) {
          res._implicitHeader()
        }

        if (chunk == null) {
          ret = true;
          return ret;
        }

        const contentLength = Number(res.getHeader('Content-Length'));

        if (!isNaN(contentLength) && contentLength > 0) {
          // measure chunk
          chunk = !Buffer.Buffer.isBuffer(chunk)
              //@ts-ignore
            ? Buffer.Buffer.from(chunk, encoding)
            : chunk;
          encoding = undefined;

          if (chunk.length !== 0) {
            debug.log('split response');
            ret = _write.call(res, chunk.slice(0, chunk.length - 1));
            chunk = chunk.slice(chunk.length - 1, chunk.length);
            return ret;
          }
        }

        ret = _write.call(res, chunk, encoding);
        sync = false;

        return ret;
      }

      if (shouldDestroy(req)) {
        // destroy session
        debug.log('destroying');
        store.destroy(req.sessionID,  (err:Error)=> {
          if (err) {
            defer(next, err);
          }

          debug.log('destroyed');
          writeend();
        });

        return writetop();
      }

      // no session to save
      if (!req.session) {
        debug.log('no session');
        return _end.call(res, chunk, encoding);
      }

      autoTouch();

      if (shouldSave(req)) {
        req.session.save((err:Error) =>{
          if (err) {
            defer(next, err);
          }

          writeend();
        })

        return writetop();
      } else if (storeImplementsTouch && shouldTouch(req)) {
        // store implements touch method
        debug.log('touching');
        store.touch(req.sessionID, req.session, function ontouch(err: Error) {
          if (err) {
            defer(next, err);
          }

          debug.log('touched');
          writeend();
        });

        return writetop();
      }

      return _end.call(res, chunk, encoding);
    }

    // generate the session
     const generate = ()=> {
      store.generate(req);
      originalId = req.sessionID;
      originalHash = hash(req.session);
      wrapmethods(req.session);
    }

    // inflate the session
    const inflate = (req:Request, sess:Session)=> {
      store.createSession(req, sess)
      originalId = req.sessionID
      originalHash = hash(sess)

      if (!resaveSession) {
        savedHash = originalHash
      }

      wrapmethods(req.session)
    }

    function rewrapmethods (sess:Session, callback:Function) {
      return function () {
        if (req.session !== sess) {
          wrapmethods(req.session)
        }

        callback.apply(this, arguments)
      }
    }

    // wrap session methods
    const wrapmethods = (sess:Session) => {
      const _reload = sess.reload
      const _save = sess.save;
      const _touch = sess.touch;

      function reload(callback:Function) {
        debug.log('reloading %s', sess.id)
        _reload.call(this, rewrapmethods(this, callback))
      }

      function save() {
        debug.log('saving %s', sess.id);
        savedHash = hash(this);
        _save.apply(this, arguments);
      }

      const touch = (callback: (err: any) => void) => {
        debug.log('touching %s', sess.id);
        const cb = callback || function (err) { if (err) throw err; };
        const touchStore = propagateTouch && storeImplementsTouch &&
            // Don't touch the store unless the session has been or will be written to the store.
            (saveUninitializedSession || isModified(this.session) || isSaved(this));
        _touch.call(this, touchStore ? (function (err: any) {
          if (err) return cb(err);
          store.touch(sess.id, this, cb);
          touchedStore = true; // Set synchronously regardless of success/failure.
        }).bind(this) : cb);
        touched = true; // Set synchronously regardless of success/failure.
        return this;
      }

      Object.defineProperty(sess, 'reload', {
        configurable: true,
        enumerable: false,
        value: reload,
        writable: true
      })

      Object.defineProperty(sess, 'save', {
        configurable: true,
        enumerable: false,
        value: save,
        writable: true
      });

      Object.defineProperty(sess, 'touch', {
        configurable: true,
        enumerable: false,
        value: touch,
        writable: true
      });
    }

    // check if session has been modified
    const isModified = (sess:Session) => {
      return originalId !== sess.id || originalHash !== hash(sess);
    }

    // check if session has been saved
    const isSaved = (sess:Session) =>{
      return originalId === sess.id && savedHash === hash(sess);
    }

    // determine if session should be destroyed
    const shouldDestroy = (req:any) =>{
      return req.sessionID && unsetDestroy && req.session == null;
    }

    // determine if session should be saved to store
    const shouldSave = (req:Request) =>{
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        debug.log('session ignored because of bogus req.sessionID %o', req.sessionID);
        return false;
      }

      return !saveUninitializedSession && !savedHash && cookieId !== req.sessionID
        ? isModified(req.session as Session)
        : !isSaved(req.session as Session)
    }

    // determine if session should be touched
    const shouldTouch = (req:Request) =>{
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        debug.log('session ignored because of bogus req.sessionID %o', req.sessionID);
        return false;
      }

      return !touchedStore && cookieId === req.sessionID && !shouldSave(req);
    }

    // determine if cookie should be set on response
    const  shouldSetCookie = (req:any) =>{
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        return false
      }

      return cookieId !== req.sessionID
        ? saveUninitializedSession || isModified(req.session)
        : rollingSessions || req.session.cookie.expires != null && isModified(req.session)
    }

    // generate a session if the browser doesn't send a sessionID
    if (!req.sessionID) {
      debug.log('no SID sent, generating session')
      generate()
      next()
      return
    }

    // generate the session object
    debug.log('fetching %s', req.sessionID)
    store.get(req.sessionID, function(err:any, sess:Session){
      // error handling
      if (err && err.code !== 'ENOENT') {
        debug.log('error %j', err)
        next(err)
        return
      }

      try {
        if (err || !sess) {
          debug.log('no session found')
          generate()
        } else {
          debug.log('session found')
          inflate(req, sess)
        }
      } catch (e) {
        next(e)
        return
      }

      next()
    });
  };
};

/**
 * Generate a session ID for a new session.
 *
 * @return {String}
 * @private
 */

function generateSessionId(sess:Session):string {
  return uid.sync(24)
}

/**
 * Get the session ID cookie from request.
 *
 * @return {string}
 * @private
 */

function getcookie(req:any, name:string, secrets:string[]) {
  const header = req.headers.cookie
  let raw
  let val

  // read from cookie header
  if (header) {
    let cookies = cookie.parse(header)

    raw = cookies[name]

    if (raw) {
      if (raw.substring(0, 2) === 's:') {
        val = unsigncookie(raw.slice(2), secrets)

        if (val === false) {
          debug.log('cookie signature invalid')
          val = undefined
        }
      } else {
        debug.log('cookie unsigned')
      }
    }
  }

  // back-compat read from cookieParser() signedCookies data
  if (!val && req.signedCookies) {
    val = req.signedCookies[name]

    if (val) {
      deprecate('cookie should be available in req.headers.cookie');
    }
  }

  // back-compat read from cookieParser() cookies data
  if (!val && req.cookies) {
    raw = req.cookies[name]

    if (raw) {
      if (raw.substr(0, 2) === 's:') {
        val = unsigncookie(raw.slice(2), secrets)

        if (val) {
          deprecate('cookie should be available in req.headers.cookie')
        }

        if (val === false) {
          debug.log('cookie signature invalid')
          val = undefined;
        }
      } else {
        debug.log('cookie unsigned')
      }
    }
  }

  return val;
}

/**
 * Hash the given `sess` object omitting changes to `.cookie`.
 *
 * @param {Object} sess
 * @return {String}
 * @private
 */

function hash(sess:Session): string {
  // serialize
  let cloned_hash = Object.assign({}, sess);
  delete cloned_hash.req
  const str = JSON.stringify(cloned_hash, function (key, val) {
    // ignore sess.cookie property
    if (this === cloned_hash && key === 'cookie') {
      return
    }

    return val
  })

  // hash
  return crypto
    .createHash('sha1')
    .update(str, 'utf8')
    .digest('hex')
}

/**
 * Determine if request is secure.
 *
 * @param {Object} req
 * @param {Boolean} [trustProxy]
 * @return {Boolean}
 * @private
 */
const issecure = (req:any, trustProxy:boolean): boolean => {
  // socket is https server
  if (req.connection && req.connection.encrypted) {
    return true;
  }

  // do not trust proxy
  if (!trustProxy) {
    return false;
  }

  // no explicit trust; try req.secure from express
  if (!trustProxy) {
    return req.secure === true
  }

  // read the proto from x-forwarded-proto header
  const header = req.headers['x-forwarded-proto'] || '';
  const index = header.indexOf(',');
  const proto = index !== -1
    ? header.substr(0, index).toLowerCase().trim()
    : header.toLowerCase().trim()

  return proto === 'https';
};

/**
 * Set cookie on response.
 *
 * @private
 */
const setcookie = (res:any, name:string, val:string, secret:string, options?:Options) => {
  const signed = 's:' + signature.sign(val, secret);
  const data = cookie.serialize(name, signed, options);

  debug.log('set-cookie %s', data);

  const prev = res.getHeader('Set-Cookie') || []
  const header = Array.isArray(prev) ? prev.concat(data) : [prev, data];

  res.setHeader('Set-Cookie', header)
};

/**
 * Verify and decode the given `val` with `secrets`.
 *
 * @param {String} val
 * @param {Array} secrets
 * @returns {String|Boolean}
 * @private
 */
const unsigncookie = (val: string, secrets:string[]): string | boolean => {
  for (let i = 0; i < secrets.length; i++) {
    const result = signature.unsign(val, secrets[i]);

    if (result !== false) {
      return result;
    }
  }

  return false;
};
