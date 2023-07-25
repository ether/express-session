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
import EventEmitter from 'events';
import Session from './session';
import util from 'util';


/**
 * Abstract base class for session stores.
 * @public
 */

abstract class Store extends Session{

  /**
   * Re-generate the given requests's session.
   *
   * @param {IncomingRequest} req
   * @param fn
   * @return {Function} fn
   * @api public
   */
  // @ts-ignore
  regenerate(req:Request, fn: Function): Function{
    const self = this;
    // @ts-ignore
    this.destroy(req.sessionID, (err:Error)=>{
        self.generate(req);
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
    this.get(sid, function(err: Error, sess:Session){
      if (err) return fn(err);
      if (!sess) return fn();
      const req = { sessionID: sid, sessionStore: self };
      fn(null, self.createSession(req as any, sess))
    })
  }
  /**
   * Create session from JSON `sess` data.
   *
   * @param {IncomingRequest} req
   * @param {Object} sess
   * @return {Session}
   * @api private
   */
  createSession(req:Request, sess: Session): Session{
    const expires = sess.cookie.expires
    const originalMaxAge = sess.cookie.originalMaxAge

    sess.cookie = new Cookie(sess.cookie);

    if (typeof expires === 'string') {
      // convert expires to a Date object
      sess.cookie.expires = new Date(expires)
    }

    // keep originalMaxAge intact
    sess.cookie.originalMaxAge = originalMaxAge

    req.session = new Session(req, sess);
    return req.session as any;
  };
}

/**
 * Inherit from EventEmitter.
 */

util.inherits(Store, EventEmitter)



export default Store
