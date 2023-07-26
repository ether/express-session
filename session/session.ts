/*!
 * Connect - session - Session
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

'use strict';

/**
 * Node.js 0.8+ async implementation.
 * @private
 */

/* istanbul ignore next */

import Cookie, {Request} from "./cookie";
import Store from "./store";
import MemoryStore, {DerefFunctionType} from "./memory";

const defer = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn: { bind: { apply: (arg0: any, arg1: IArguments) => Function; }; }){ process.nextTick(fn.bind.apply(fn, arguments)) }

/**
 * Expose Session.
 */



/**
 * Create a new `Session` with the given request and `data`.
 *
 * @param {Function} req
 * @param {Object} data
 * @api private
 */


class Session {
  req: { value: Request | undefined, session?:Session, sessionStore?:MemoryStore }
  id: { value: string }|string
  cookie: Cookie | undefined

  constructor(req?: Request, data?: object) {
    this.req = {value: req}
    this.id = {
      value: req!.sessionID as string
    }


    if (typeof data === 'object' && data !== null) {
      // merge data into this, ignoring prototype properties
      for (const prop in data) {
        if (!(prop in this)) {
          // @ts-ignore
          this[prop] = data[prop]
        }
      }
    }
  }


  /**
   * Reset `.maxAge` to `.originalMaxAge`.
   *
   * @return {Session} for chaining
   * @api public
   */
  resetMaxAge(): Session {
    if (this.cookie instanceof Cookie) {
      this.cookie.maxAge = this.cookie.originalMaxAge as number;
    }
    return this;
  }

  /**
   * Update reset `.cookie.maxAge` to prevent
   * the cookie from expiring when the
   * session is still active.
   *
   * @param {Function} fn optional done callback
   * @return {Session} for chaining
   * @api public
   */
  touch(fn?: DerefFunctionType): Session{
    this.resetMaxAge()
    if (fn) defer(fn)
    return this
  }


  /**
   * Save the session data with optional callback `fn(err)`.
   *
   * @param {Function} fn
   * @return {Session} for chaining
   * @api public
   */
  save(this: any, fn: any): Session{
    this.req.sessionStore.set(this.id, this, fn || function(){});
    return this;
  }

  /**
   * Re-loads the session data _without_ altering
   * the maxAge properties. Invokes the callback `fn(err)`,
   * after which time if no exception has occurred the
   * `req.session` property will be a new `Session` object,
   * although representing the same session.
   *
   * @param {Function} fn
   * @return {Session} for chaining
   * @api public
   */
  reload(this: any, fn: (arg0?: Error) => void): Session{
    const req = this.req
    const store = this.req.sessionStore

    store.get(this.id, function(err:Error, sess:any){
      if (err) return fn(err);
      if (!sess) return fn(new Error('failed to load session'));
      store.createSession(req, sess);
      fn();
    });
    return this;
  }

  /**
   * Destroy `this` session.
   *
   * @param {Function} fn
   * @return {Session} for chaining
   * @api public
   */
  destroy(fn: DerefFunctionType): Session{
    delete this.req.session;
    this.req.sessionStore!.destroy(this.id as string, fn);
    return this;
  }
  /**
   * Regenerate this request's session.
   *
   * @param {Function} fn
   * @return {Session} for chaining
   * @api public
   */
  regenerate(this: any, fn: any): Session{
    this.req.sessionStore.regenerate(this.req, fn);
    return this;
  }
}

export default Session
