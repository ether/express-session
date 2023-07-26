/*!
 * Connect - session - Cookie
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */


/**
 * Module dependencies.
 */

import cookie from 'cookie';
import Session from "./session";
import Store from "./store";
import deprecate from "depd";


export type Request = {
  sessionStore: Store;
  secret?: string;
  sessionID?: string;
  session?: Session
  url?: string | any[];
  originalUrl?: any,
  value?: Request
}

export type Options = any

/**
 * Initialize a new `Cookie` with the given `options`.
 *
 * @param {IncomingMessage} req
 * @param {Object} options
 * @api private
 */

export default class Cookie {
  readonly httpOnly: boolean;
  private readonly _maxAge: number | null;
  readonly path: string;
  originalMaxAge: number|undefined = undefined;
  private _expires: Date | null;
  private secure: any;
  private domain: any;
  private sameSite: any;
  constructor(options?: any) {
    this.path = '/';
    this._maxAge = null;
    this.httpOnly = true;
    this._expires = null
    if (options) {
      if (typeof options !== 'object') {
        throw new TypeError('argument options must be a object')
      }

      for (const key in options) {
        if (key !== 'data') {
          // @ts-ignore
          this[key] = options[key]
        }
      }
    }

    if (this.originalMaxAge === undefined || this.originalMaxAge === null) {
      this.originalMaxAge = this.maxAge
    }
  }

  /**
   * Set expires `date`.
   *
   * @param {Date} date
   * @api public
   */

  set expires(date: Date) {
    this._expires = date;
    this.originalMaxAge = this._maxAge as number;
  }


  /**
   * Get expires `date`.
   *
   * @return {Date}
   * @api public
   */

  get expires(): Date | null {
    return this._expires;
  }


  /**
   * Set expires via max-age in `ms`.
   *
   * @param {Number} ms
   * @api public
   */
  set maxAge(ms: number|Date|Object) {
    if (ms && typeof ms !== 'number' && !(ms instanceof Date)) {
      throw new TypeError('maxAge must be a number or Date')
    }

    if (ms instanceof Date) {
      deprecate('maxAge as Date; pass number of milliseconds instead')
    }

    this.expires = typeof ms === 'number'
        ? new Date(Date.now() + ms)
        : ms;
  }

  /**
   * Get expires max-age in `ms`.
   *
   * @return {Number}
   * @api public
   */

  get maxAge(): number {
    // @ts-ignore
    return this.expires instanceof Date
        ? this.expires.valueOf() - Date.now()
        : this.expires;
  }

  /**
   * Return cookie data object.
   *
   * @return {Object}
   * @api private
   */

  get data(): any {
    return {
      originalMaxAge: this.originalMaxAge
      , expires: this._expires
      , secure: this.secure
      , httpOnly: this.httpOnly
      , domain: this.domain
      , path: this.path
      , sameSite: this.sameSite
    }
  }
  /**
   * Return a serialized cookie string.
   *
   * @return {String}
   * @api public
   */

  serialize(name: string, val:string): string{
  return cookie.serialize(name, val, this.data);
}

  /**
   * Return JSON representation of this cookie.
   *
   * @return {Object}
   * @api private
   */
  toJSON = (): object => this.data;
}
