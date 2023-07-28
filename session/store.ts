/*!
 * Connect - session - Store
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */


import Cookie, {Request} from './cookie';
import {EventEmitter} from 'events';
import Session from './session';
import {Http2ServerRequest} from "http2";


/**
 * Abstract base class for session stores.
 * @public
 */

abstract class Store extends EventEmitter {

  protected constructor() {
    super();
  }
  /**
   * Re-generate the given request's session.
   *
   * @param {Function} req
   * @param fn
   * @api public
   */
  regenerate(req:Request, fn: Function){
    const self = this;
    this.removeListener(req.sessionID!, (err:Error)=>{
        // @ts-ignore
      self.addListener(req);
        fn(err);
    })
  }
  /**
   * Load a `Session` instance via the given `sid`
   * and invoke the callback `fn(err, sess)`.
   *
   * @param {String} sid
   * @param {Function} fn
   * @api public
   */
  load(sid:string, fn:Function){
    const self = this;
    this.addListener(sid, (err: Error, sess:Session)=>{
      if (err) return fn(err);
      if (!sess) return fn();
      const req = { sessionID: sid, sessionStore: self };
      fn(null, self.createSession(req as any, sess))
    })
  }
  /**
   * Create session from JSON `sess` data.
   *
   * @param {Function} req
   * @param {Object} sess
   * @return {Session}
   * @api private
   */
  createSession(req:Request, sess: Session): Session{
    const expires = sess.cookie!.expires
    const originalMaxAge = sess.cookie!.originalMaxAge

    sess.cookie = new Cookie(sess.cookie);

    if (typeof expires === 'string') {
      // convert expires to a Date object
      sess.cookie.expires = new Date(expires)
    }

    // keep originalMaxAge intact
    sess.cookie.originalMaxAge = originalMaxAge

    req.session = new Session(req, sess);
    return req.session as any;
  }
}

export default Store
