/*!
 * express-session
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */
import Store from './store';
import util from 'util';

/**
 * Shim setImmediate for node.js < 0.10
 * @private
 */

/* istanbul ignore next */
const defer: DerefFunctionType = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn:Function){ process.nextTick(fn.bind.apply(fn, arguments as any)) }

/**
 * Module exports.
 */

export type DerefFunctionType = (...args: any) => void


/**
 * A session store in memory.
 * @public
 */
class MemoryStore extends Store {
  private sessions: any;
  constructor() {
    super()
    this.sessions = Object.create(null)
  }

  /**
   * Get all active sessions.
   *
   * @param {function} callback
   * @public
   */
  all(callback: DerefFunctionType) {
    const sessionIds = Object.keys(this.sessions)
    const sessions = Object.create(null)

    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i]
      const session = this.getSession.call(this, sessionId)

      if (session) {
        sessions[sessionId] = session;
      }
    }

    callback && defer(callback, null, sessions)
  }
  /**
   * Clear all sessions.
   *
   * @param {function} callback
   * @public
   */
  clear(callback:DerefFunctionType) {
    this.sessions = Object.create(null)
    callback && defer(callback)
  }
  /**
   * Destroy the session associated with the given session ID.
   *
   * @param {string} sessionId
   * @param callback
   * @public
   */
  destroy(sessionId: string, callback:DerefFunctionType) {
    delete this.sessions[sessionId]
    callback && defer(callback)
  }
  /**
   * Fetch session by the given session ID.
   *
   * @param {string} sessionId
   * @param {function} callback
   * @public
   */
  get(sessionId: string, callback:DerefFunctionType) {
    defer(callback, null, this.getSession.call(this, sessionId))
  }

  /**
   * Commit the given session associated with the given sessionId to the store.
   *
   * @param {string} sessionId
   * @param {object} session
   * @param {function} callback
   * @public
   */
  set(sessionId: string, session:any, callback:DerefFunctionType) {
    this.sessions[sessionId] = JSON.stringify(session)
    callback && defer(callback)
  }

  /**
   * Get number of active sessions.
   *
   * @param {function} callback
   * @public
   */

  length(callback: DerefFunctionType) {
    this.all(function (err, sessions) {
      if (err) return callback(err)
      callback(null, Object.keys(sessions).length)
    })
  }

  /**
   * Touch the given session object associated with the given session ID.
   *
   * @param {string} sessionId
   * @param {object} session
   * @param {function} callback
   * @public
   */
  touch(sessionId: string, session: any, callback:DerefFunctionType) {
    const currentSession = this.getSession.call(this, sessionId)

    if (currentSession) {
      // update expiration
      currentSession.cookie = session.cookie
      this.sessions[sessionId] = JSON.stringify(currentSession)
    }

    callback && defer(callback)
  }

  /**
   * Get session from the store.
   * @private
   */
  private getSession(sessionId: string) {
    let sess = this.sessions[sessionId]

    if (!sess) {
      return
    }

    // parse
    sess = JSON.parse(sess)

    if (sess.cookie) {
      const expires = typeof sess.cookie.expires === 'string'
          ? new Date(sess.cookie.expires)
          : sess.cookie.expires

      // destroy expired session
      if (expires && expires <= Date.now()) {
        delete this.sessions[sessionId]
        return
      }
    }

    return sess
  }
}
export default MemoryStore




