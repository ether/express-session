// @ts-ignore
import after from 'after'
import assert from 'assert'
import cookieParser from 'cookie-parser'
import express, {Express} from 'express'
import fs from 'fs'
import http from 'node:http'
import https from 'node:https'
import SmartStore from './support/smart-store'
import SyncStore from './support/sync-store'
import {writePatch,parseSetCookie} from './support/utils'
import Cookie, {Options} from '../session/cookie'
import Store from "../session/store";
import request from 'supertest'
import Session from "../session/session";
import MemoryStore from "../session/memory";
import {session} from "../index";

const min = 60 * 1000;
type Response = any
type Request = any

/* istanbul ignore next */
const defer = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn: { bind: { apply: (arg0: any, arg1: IArguments) => Function } }){ process.nextTick(fn.bind.apply(fn, arguments)) }

describe('session()', function(){
  it('should export constructors', function(){
    assert.strictEqual(typeof Session, 'function')
    assert.strictEqual(typeof Store, 'function')
    assert.strictEqual(typeof MemoryStore, 'function')
  })

  it('should do nothing if req.session exists', function(done){
    const setup = (req: any)=> {
      req.session = {}
    }

    request(createServer(setup))
    .get('/')
    .expect(shouldNotHaveHeader('Set-Cookie'))
    .expect(200, done)
  })

  it('should error without secret', function(done){
    request(createServer({ secret: undefined }))
    .get('/')
    .expect(500, /secret.*required/, done)
  })

  it('should get secret from req.secret', function(done){
    function setup (req: Request) {
      req.secret = 'keyboard cat'
    }

    request(createServer(setup, { secret: undefined }))
    .get('/')
    .expect(200, '', done)
  })

  it('should create a new session', function (done) {
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req: Request, res: Response) {
      req.session!.active = true
      res.end('session active')
    });

    request(server)
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, 'session active', function (err, res) {
      if (err) return done(err)
      store.length(function (err:any, len: number) {
        if (err) return done(err)
        assert.strictEqual(len, 1)
        done()
      })
    })
  })

  it('should load session from cookie sid', function (done) {
    let count = 0
    const server = createServer(null,  (req: Request, res: Response)=> {
      req.session!.num = req.session.num || ++count
      res.end('session ' + req.session.num)
    })

    request(server)
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, 'session 1',  (err, res)=> {
      if (err) return done(err)
      request(server)
      .get('/')
      .set('Cookie', cookie(res as any))
      .expect(200, 'session 1', done)
    })
  })

  it('should pass session fetch error', function (done) {
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req: Request, res: Response) {
      res.end('hello, world')
    })

    store.get = function destroy(sid, callback:Function) {
      callback(new Error('boom!'))
    }

    request(server)
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, 'hello, world', function (err, res) {
      if (err) return done(err)
      request(server)
      .get('/')
      .set('Cookie', cookie(res as any))
      .expect(500, 'boom!', done)
    })
  })

  it('should treat ENOENT session fetch error as not found', function (done) {
    let count = 0
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req:Request, res:Response) {
      req.session.num = req.session.num || ++count
      res.end('session ' + req.session.num)
    })

    store.get = function destroy(sid, callback:Function) {
      const err = new Error('boom!')
      // @ts-ignore
      err.code = 'ENOENT'
      callback(err)
    }

    request(server)
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, 'session 1',  (err, res)=> {
      if (err) return done(err)
      request(server)
      .get('/')
      .set('Cookie', cookie(res as any))
      .expect(200, 'session 2', done)
    })
  })

  it('should create multiple sessions', function (done) {
    const cb = after(2, check)
    let count = 0
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req:Request, res:Response) {
      const isnew = req.session.num === undefined
      req.session.num = req.session.num || ++count
      res.end('session ' + (isnew ? 'created' : 'updated'))
    });

    function check(err: Error) {
      if (err) return done(err)
      store.all((err:Error, sess:any) => {
        if (err) return done(err)
        assert.strictEqual(Object.keys(sess).length, 2)
        done()
      })
    }

    request(server)
    .get('/')
    .expect(200, 'session created', cb)

    request(server)
    .get('/')
    .expect(200, 'session created', cb)
  })

  it('should handle empty req.url', function (done) {
    function setup (req:any) {
      req.url = ''
    }

    request(createServer(setup))
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, done)
  })

  it('should handle multiple res.end calls', function(done){
    const server = createServer(null, function (req:Request, res:Response) {
      res.setHeader('Content-Type', 'text/plain')
      res.end('Hello, world!')
      res.end()
    })

    request(server)
    .get('/')
    .expect('Content-Type', 'text/plain')
    .expect(200, 'Hello, world!', done);
  })

  it('should handle res.end(null) calls', function (done) {
    const server = createServer(null, function (req:Request, res:Response) {
      res.end(null)
    })

    request(server)
    .get('/')
    .expect(200, '', done)
  })

  it('should handle reserved properties in storage', function (done) {
    let count = 0
    let sid: string
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req:Request, res:Response) {
      sid = req.session.id
      req.session.num = req.session.num || ++count
      res.end('session saved')
    })

    request(server)
    .get('/')
    .expect(200, 'session saved', function (err, res) {
      if (err) return done(err)
      store.get(sid, function (err, sess) {
        if (err) return done(err)
        // save is reserved
        sess.save = 'nope'
        store.set(sid, sess, function (err) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, 'session saved', done)
        })
      })
    })
  })

  it('should only have session data enumerable (and cookie)', function (done) {
    const server = createServer(null, function (req:any, res: any) {
      req.session.test1 = 1
      req.session.test2 = 'b'
      res.end(Object.keys(req.session).sort().join(','))
    })

    request(server)
    .get('/')
    .expect(200, 'cookie,test1,test2', done)
  })

  it('should not save with bogus req.sessionID', function (done) {
    const store = new MemoryStore()
    const server = createServer({ store: store }, function (req:any, res:any) {
      req.sessionID = function () {}
      req.session.test1 = 1
      req.session.test2 = 'b'
      res.end()
    })

    request(server)
    .get('/')
    .expect(shouldNotHaveHeader('Set-Cookie'))
    .expect(200, function (err) {
      if (err) return done(err)
      store.length(function (err, length) {
        if (err) return done(err)
        assert.strictEqual(length, 0)
        done()
      })
    })
  })

  it('should update cookie expiration when slow write', function (done) {
    const server = createServer({ rolling: true }, function (req: Request, res: Response) {
      req.session!.user = 'bob'
      res.write('hello, ')
      setTimeout(function () {
        res.end('world!')
      }, 200)
    })

    request(server)
    .get('/')
    .expect(shouldSetCookie('connect.sid'))
    .expect(200, function (err, res) {
      if (err) return done(err);
      const originalExpires = expires(res);
      setTimeout(function () {
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(shouldSetCookie('connect.sid'))
        .expect(function (res) { assert.notStrictEqual(originalExpires, expires(res)); })
        .expect(200, done);
      }, (1000 - (Date.now() % 1000) + 200));
    });
  });

  describe('when response ended', function () {
    it('should have saved session', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.hit = true
        res.end('session saved')
      })

      request(server)
        .get('/')
        .expect(200)
        .expect(shouldSetSessionInStore(store, 200))
        .expect('session saved')
        .end(done)
    })

    it('should have saved session even with empty response', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.hit = true
        res.setHeader('Content-Length', '0')
        res.end()
      })

      request(server)
        .get('/')
        .expect(200)
        .expect(shouldSetSessionInStore(store, 200))
        .end(done)
    })

    it('should have saved session even with multi-write', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.hit = true
        res.setHeader('Content-Length', '12')
        res.write('hello, ')
        res.end('world')
      })

      request(server)
        .get('/')
        .expect(200)
        .expect(shouldSetSessionInStore(store, 200))
        .expect('hello, world')
        .end(done)
    })

    it('should have saved session even with non-chunked response', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.hit = true
        res.setHeader('Content-Length', '13')
        res.end('session saved')
      })

      request(server)
        .get('/')
        .expect(200)
        .expect(shouldSetSessionInStore(store, 200))
        .expect('session saved')
        .end(done)
    })

    it('should have saved session with updated cookie expiration', function (done) {
      const store = new MemoryStore()
      const server = createServer({ cookie: { maxAge: min }, store: store }, function (req:Request, res:Response) {
        req.session.user = 'bob'
        res.end(req.session.id)
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, function (err, res) {
        if (err) return done(err)
        const id = res.text
        store.get(id, function (err, sess) {
          if (err) return done(err)
          assert.ok(sess, 'session saved to store')
          const exp = new Date(sess.cookie.expires)
          assert.strictEqual(exp.toUTCString(), expires(res))
          setTimeout(function () {
            request(server)
            .get('/')
            .set('Cookie', cookie(res))
            .expect(200, function (err, res) {
              if (err) return done(err)
              store.get(id, function (err, sess) {
                if (err) return done(err)
                assert.strictEqual(res.text, id)
                assert.ok(sess, 'session still in store')
                assert.notStrictEqual(new Date(sess.cookie.expires).toUTCString(), exp.toUTCString(), 'session cookie expiration updated')
                done()
              })
            })
          }, (1000 - (Date.now() % 1000) + 200))
        })
      })
    })
  })

  describe('when sid not in store', function () {
    it('should create a new session', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      });

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        store.clear(function (err) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, 'session 2', done)
        })
      })
    })

    it('should have a new sid', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      });

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        store.clear(function (err) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetCookie('connect.sid'))
          .expect(shouldSetCookieToDifferentSessionId(sid(res)))
          .expect(200, 'session 2', done)
        })
      })
    })
  })

  describe('when sid not properly signed', function () {
    it('should generate new session', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store, key: 'sessid' }, function (req:Request, res:Response) {
        const isnew = req.session.active === undefined
        req.session.active = true
        res.end('session ' + (isnew ? 'created' : 'read'))
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('sessid'))
      .expect(200, 'session created', function (err, res) {
        if (err) return done(err)
        const val = sid(res)
        assert.ok(val)
        request(server)
        .get('/')
        .set('Cookie', 'sessid=' + val)
        .expect(shouldSetCookie('sessid'))
        .expect(shouldSetCookieToDifferentSessionId(val))
        .expect(200, 'session created', done)
      })
    })

    it('should not attempt fetch from store', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store, key: 'sessid' }, function (req:Request, res:Response) {
        const isnew = req.session.active === undefined
        req.session.active = true
        res.end('session ' + (isnew ? 'created' : 'read'))
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('sessid'))
      .expect(200, 'session created', function (err, res) {
        if (err) return done(err)
        const val = cookie(res).replace(/...\./, '.')

        assert.ok(val)
        request(server)
        .get('/')
        .set('Cookie', val)
        .expect(shouldSetCookie('sessid'))
        .expect(200, 'session created', done)
      })
    })
  })

  describe('when session expired in store', function () {
    it('should create a new session', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store, cookie: { maxAge: 5 } }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      });

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        setTimeout(function () {
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 2', done)
        }, 20)
      })
    })

    it('should have a new sid', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store, cookie: { maxAge: 5 } }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      });

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        setTimeout(function () {
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetCookie('connect.sid'))
          .expect(shouldSetCookieToDifferentSessionId(sid(res)))
          .expect(200, 'session 2', done)
        }, 15)
      })
    })

    it('should not exist in store', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store, cookie: { maxAge: 5 } }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      });

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        setTimeout(function () {
          store.all(function (err, sess) {
            if (err) return done(err)
            assert.strictEqual(Object.keys(sess).length, 0)
            done()
          })
        }, 10)
      })
    })
  })

  describe('when session without cookie property in store', function () {
    it('should pass error from inflate', function (done) {
      let count = 0
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.num = req.session.num || ++count
        res.end('session ' + req.session.num)
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, 'session 1', function (err, res) {
        if (err) return done(err)
        store.set(sid(res), { foo: 'bar' }, function (err) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(500, /Cannot read prop/, done)
        })
      })
    })
  })

  describe('proxy option', function(){
    describe('when enabled', function(){
      let server:  any
      before(function () {
        server = createServer({ proxy: true, cookie: { secure: true, maxAge: 5 }})
      })

      it('should trust X-Forwarded-Proto when string', function(done){
        request(server)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, done)
      })

      it('should trust X-Forwarded-Proto when comma-separated list', function(done){
        request(server)
        .get('/')
        .set('X-Forwarded-Proto', 'https,http')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, done)
      })

      it('should work when no header', function(done){
        request(server)
        .get('/')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      })
    })

    describe('when disabled', function(){
      before(function () {
        function setup (req: Request) {
          req.secure = req.headers['x-secure']
            ? JSON.parse(req.headers['x-secure'])
            : undefined
        }

        function respond (req: Request, res: Response) {
          res.end(String(req.secure))
        }

        // @ts-ignore
        this.server = createServer(setup, { proxy: false, cookie: { secure: true }}, respond)
      })

      it('should not trust X-Forwarded-Proto', function(done){
        request(this.server)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      })

      it('should ignore req.secure', function (done) {
        request(this.server)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Secure', 'true')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, 'true', done)
      })
    })

    describe('when unspecified', function(){
      before(function () {
        function setup (req: Request) {
          req.secure = req.headers['x-secure']
            ? JSON.parse(req.headers['x-secure'])
            : undefined
        }

        function respond (req: Request, res: Response) {
          res.end(String(req.secure))
        }

        // @ts-ignore
        this.server = createServer(setup, { cookie: { secure: true }}, respond)
      })

      it('should not trust X-Forwarded-Proto', function(done){
        request(this.server)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      })

      it('should use req.secure', function (done) {
        request(this.server)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Secure', 'true')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'true', done)
      })
    })
  })

  describe('cookie option', function () {
    describe('when "path" set to "/foo/bar"', function () {
      before(function () {
        this.server = createServer({ cookie: { path: '/foo/bar' } })
      })

      it('should not set cookie for "/" request', function (done) {
        request(this.server)
        .get('/')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      })

      it('should not set cookie for "http://foo/bar" request', function (done) {
        request(this.server)
        .get('/')
        .set('host', 'http://foo/bar')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      })

      it('should set cookie for "/foo/bar" request', function (done) {
        request(this.server)
        .get('/foo/bar/baz')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, done)
      })

      it('should set cookie for "/foo/bar/baz" request', function (done) {
        request(this.server)
        .get('/foo/bar/baz')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, done)
      })

      describe('when mounted at "/foo"', function () {
        before(function () {
          this.server = createServer(mountAt('/foo'), { cookie: { path: '/foo/bar' } })
        })

        it('should set cookie for "/foo/bar" request', function (done) {
          request(this.server)
          .get('/foo/bar')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done)
        })

        it('should not set cookie for "/foo/foo/bar" request', function (done) {
          request(this.server)
          .get('/foo/foo/bar')
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, done)
        })
      })
    })

    describe('when "secure" set to "auto"', function () {
      describe('when "proxy" is "true"', function () {
        before(function () {
          this.server = createServer({ proxy: true, cookie: { maxAge: 5, secure: 'auto' }})
        })

        it('should set secure when X-Forwarded-Proto is https', function (done) {
          request(this.server)
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
          .expect(200, done)
        })
      })

      describe('when "proxy" is "false"', function () {
        before(function () {
          this.server = createServer({ proxy: false, cookie: { maxAge: 5, secure: 'auto' }})
        })

        it('should not set secure when X-Forwarded-Proto is https', function (done) {
          request(this.server)
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
          .expect(200, done)
        })
      })

      describe('when "proxy" is undefined', function() {
        before(function () {
          function setup (req:Request) {
            req.secure = JSON.parse(req.headers['x-secure'])
          }

          function respond (req:Request, res:Response) {
            res.end(String(req.secure))
          }

          // @ts-ignore
          this.server = createServer(setup, { cookie: { secure: 'auto' } }, respond)
        })

        it('should set secure if req.secure = true', function (done) {
          request(this.server)
          .get('/')
          .set('X-Secure', 'true')
          .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
          .expect(200, 'true', done)
        })

        it('should not set secure if req.secure = false', function (done) {
          request(this.server)
          .get('/')
          .set('X-Secure', 'false')
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
          .expect(200, 'false', done)
        })
      })
    })
  })

  describe('genid option', function(){
    it('should reject non-function values', function(){
      assert.throws(session.bind(null, { genid: 'bogus!' }), /genid.*must/)
    });

    it('should provide default generator', function(done){
      request(createServer())
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done)
    });

    it('should allow custom function', function(done){
      function genid() { return 'apple' }

      request(createServer({ genid: genid }))
      .get('/')
      .expect(shouldSetCookieToValue('connect.sid', 's%3Aapple.D8Y%2BpkTAmeR0PobOhY4G97PRW%2Bj7bUnP%2F5m6%2FOn1MCU'))
      .expect(200, done)
    });

    it('should encode unsafe chars', function(done){
      function genid() { return '%' }

      request(createServer({ genid: genid }))
      .get('/')
      .expect(shouldSetCookieToValue('connect.sid', 's%3A%25.kzQ6x52kKVdF35Qh62AWk4ZekS28K5XYCXKa%2FOTZ01g'))
      .expect(200, done)
    });

    it('should provide req argument', function(done){
      function genid(req:any) { return req.url }

      request(createServer({ genid: genid }))
      .get('/foo')
      .expect(shouldSetCookieToValue('connect.sid', 's%3A%2Ffoo.paEKBtAHbV5s1IB8B2zPnzAgYmmnRPIqObW4VRYj%2FMQ'))
      .expect(200, done)
    });
  });

  describe('key option', function(){
    it('should default to "connect.sid"', function(done){
      request(createServer())
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done)
    })

    it('should allow overriding', function(done){
      request(createServer({ key: 'session_id' }))
      .get('/')
      .expect(shouldSetCookie('session_id'))
      .expect(200, done)
    })
  })

  describe('name option', function () {
    it('should default to "connect.sid"', function (done) {
      request(createServer())
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done)
    })

    it('should set the cookie name', function (done) {
      request(createServer({ name: 'session_id' }))
      .get('/')
      .expect(shouldSetCookie('session_id'))
      .expect(200, done)
    })
  })

  describe('propagateTouch option', function () {
    it('defaults to false', function (done) {
      let called = false;
      const store = new MemoryStore();
      store.touch = function touch(sid, sess, callback) { called = true; defer(callback); };
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        assert(!called);
        req.session.modified = true;
        req.session.touch(function (err:Error) {
          if (err) throw err;
          assert(!called);
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    it('does not call store.touch() if unimplemented', function (done) {
      const store = new MemoryStore();
      // @ts-ignore
      store.touch = null;
      const server = createServer({ propagateTouch: true, store: store }, function (req:Request, res:Response) {
        req.session.modified = true;
        req.session.touch(function (err:Error) {
          if (err) throw err;
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    it('calls store.touch() if implemented', function (done) {
      const store = new MemoryStore();
      let called = false;
      store.touch = function touch(sid, sess, callback) { called = true; defer(callback); };
      const server = createServer({ propagateTouch: true, store: store }, function (req:Request, res:Response) {
        req.session.modified = true;
        assert(!called);
        req.session.touch(function (err:Error) {
          if (err) throw err;
          assert(called);
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    it('waits for store.touch() to complete', function (done) {
      const store = new MemoryStore();
      let called = false;
      store.touch = function touch(sid, sess, callback) {
        setTimeout(function () { called = true; callback(); }, 100);
      };
      const server = createServer({ propagateTouch: true, store: store }, function (req:Request, res:Response) {
        req.session.modified = true;
        assert(!called);
        req.session.touch(function (err:Error) {
          if (err) throw err;
          assert(called);
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    it('passes back store.touch() error', function (done) {
      const store = new MemoryStore();
      store.touch = function touch(sid, sess, callback) { defer(callback, new Error('boom!')); };
      const server = createServer({ propagateTouch: true, store: store }, function (req:Request, res:Response) {
        req.session.modified = true;
        req.session.touch(function (err:Error) {
          assert(err != null);
          assert.strictEqual(err.message, 'boom!');
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    xit('suppresses automatic session.touch()', function (done) {
      // TODO
    });

    xit('suppresses automatic session.touch() even on failure', function (done) {
      // TODO
    });

    xit('only suppresses automatic session.touch() if session.touch() attempted', function (done) {
      // TODO
    });

    it('suppresses automatic store.touch()', function (done) {
      const store = new MemoryStore();
      let calls = 0;
      store.touch = function touch(sid, sess, callback) { ++calls; defer(callback); };
      let doTouch = false;
      const server = createServer({ propagateTouch: true, store: store }, function (req:Request, res:Response) {
        req.session.modified = true;
        const callsBefore = calls;
        req.session.touch(function (err:Error) {
          if (err) throw err;
          assert.strictEqual(calls, callsBefore + 1);
          res.end();
        });
      });
      assert.strictEqual(calls, 0);
      // Two requests must be made for this test because the middleware never calls store.touch()
      // automatically on first request (it calls store.save() instead).
      request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, function (err, res) {
            if (err) return done(err);
            assert.strictEqual(calls, 1);
            doTouch = true;
            request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(200, function (err) {
                  if (err) return done(err);
                  assert.strictEqual(calls, 2);
                  done();
                });
          });
    });

    xit('suppresses automatic store.touch() even on failure', function (done) {
      // TODO
    });

    xit('only suppresses automatic store.touch() if store.touch() was attempted', function (done) {
      // TODO
    });

    xit('keeps working after automatic touch', function (done) {
      // TODO
    });

    it('always calls store.touch() when saveUninitialized=true', function (done) {
      let called = false;
      const store = new MemoryStore();
      store.touch = function touch(sid, sess, callback) { called = true; defer(callback); };
      const server = createServer({
        propagateTouch: true,
        store: store,
        saveUninitialized: true,
      }, function (req:Request, res:Response) {
        assert(!called);
        req.session.touch(function (err:Error) {
          if (err) throw err;
          assert(called);
          res.end();
        });
      });
      request(server).get('/').expect(200, done);
    });

    it('calls store.touch() iff modified when saveUninitialized=false', function (done) {
      let called = false;
      const store = new MemoryStore();
      store.touch = function touch(sid, sess, callback) { called = true; defer(callback); };
      const server = createServer({
        propagateTouch: true,
        store: store,
        saveUninitialized: false,
      }, function (req:Request, res:Response) {
        assert(!called);
        req.session.touch(function (err:Error) {
          if (err) throw err;
          req.session.modified = true;
          assert(!called);
          req.session.touch(function (err:Error) {
            if (err) throw err;
            assert(called);
            res.end();
          });
        });
      });
      request(server).get('/').expect(200, done);
    });
  });

  describe('rolling option', function(){
    it('should default to false', function(done){
      const server = createServer(null, function (req:Request, res:Response) {
        req.session.user = 'bob'
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, function(err, res){
        if (err) return done(err);
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, done)
      });
    });

    it('should force cookie on unmodified session', function(done){
      const server = createServer({ rolling: true }, function (req:Request, res:Response) {
        req.session.user = 'bob'
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, function(err, res){
        if (err) return done(err);
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, done)
      });
    });

    it('should not force cookie on uninitialized session if saveUninitialized option is set to false', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, rolling: true, saveUninitialized: false })

      request(server)
      .get('/')
      .expect(shouldNotSetSessionInStore(store))
      .expect(shouldNotHaveHeader('Set-Cookie'))
      .expect(200, done)
    });

    it('should force cookie and save uninitialized session if saveUninitialized option is set to true', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, rolling: true, saveUninitialized: true })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done)
    });

    it('should force cookie and save modified session even if saveUninitialized option is set to false', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, rolling: true, saveUninitialized: false }, function (req:Request, res:Response) {
        req.session.user = 'bob'
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done);
    });
  });

  describe('resave option', function(){
    it('should default to true', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.user = 'bob'
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(200, function(err, res){
        if (err) return done(err);
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(shouldSetSessionInStore(store))
        .expect(200, done);
      });
    });

    describe('when true', function () {
      it('should force save on unmodified session', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store, resave: true }, function (req:Request, res:Response) {
          req.session.user = 'bob'
          res.end()
        })

        request(server)
        .get('/')
        .expect(shouldSetSessionInStore(store))
        .expect(200, function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetSessionInStore(store))
          .expect(200, done)
        })
      })
    })

    describe('when false', function () {
      it('should prevent save on unmodified session', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store, resave: false }, function (req:Request, res:Response) {
          req.session.user = 'bob'
          res.end()
        })

        request(server)
        .get('/')
        .expect(shouldSetSessionInStore(store))
        .expect(200, function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldNotSetSessionInStore(store))
          .expect(200, done)
        })
      })

      it('should still save modified session', function (done) {
        const store = new MemoryStore()
        const server = createServer({ resave: false, store: store }, function (req:Request, res:Response) {
          if (req.method === 'PUT') {
            req.session.token = req.url.substr(1)
          }
          res.end('token=' + (req.session.token || ''))
        })

        request(server)
        .put('/w6RHhwaA')
        .expect(200)
        .expect(shouldSetSessionInStore(store))
        .expect('token=w6RHhwaA')
        .end(function (err, res) {
          if (err) return done(err)
          const sess = cookie(res)
          request(server)
          .get('/')
          .set('Cookie', sess)
          .expect(200)
          .expect(shouldNotSetSessionInStore(store))
          .expect('token=w6RHhwaA')
          .end(function (err) {
            if (err) return done(err)
            request(server)
            .put('/zfQ3rzM3')
            .set('Cookie', sess)
            .expect(200)
            .expect(shouldSetSessionInStore(store))
            .expect('token=zfQ3rzM3')
            .end(done)
          })
        })
      })

      it('should detect a "cookie" property as modified', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store, resave: false },
            function (req:Request, res:Response) {
          req.session.user = req.session.user || {}
          req.session.user.name = 'bob'
          req.session.user.cookie = req.session.user.cookie || 0
          req.session.user.cookie++
          res.end()
        })

        request(server)
        .get('/')
        .expect(shouldSetSessionInStore(store))
        .expect(200, function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetSessionInStore(store))
          .expect(200, done)
        })
      })

      it('should pass session touch error', function (done) {
        const cb = after(2, done)
        const store = new MemoryStore()
        const server = createServer({ store: store, resave: false }, function (req:Request, res:Response) {
          req.session.hit = true
          res.end('session saved')
        })

        store.touch = function touch (sid, sess, callback) {
          callback(new Error('boom!'))
        }

        server.on('error', function onerror (err) {
          assert.ok(err)
          assert.strictEqual(err.message, 'boom!')
          cb()
        })

        request(server)
        .get('/')
        .expect(200, 'session saved', function (err, res) {
          if (err) return cb(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .end(cb)
        })
      })
    })
  });

  describe('saveUninitialized option', function(){
    it('should default to true', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done);
    });

    it('should force save of uninitialized session', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, saveUninitialized: true })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done);
    });

    it('should prevent save of uninitialized session', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, saveUninitialized: false })

      request(server)
      .get('/')
      .expect(shouldNotSetSessionInStore(store))
      .expect(shouldNotHaveHeader('Set-Cookie'))
      .expect(200, done)
    });

    it('should still save modified session', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store, saveUninitialized: false }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        req.session.count++
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldSetSessionInStore(store))
      .expect(shouldSetCookie('connect.sid'))
      .expect(200, done);
    });

    it('should pass session save error', function (done) {
      const cb = after(2, done)
      const store = new MemoryStore()
      const server = createServer({ store: store, saveUninitialized: true }, function (req:Request, res:Response) {
        res.end('session saved')
      })

      store.set = function destroy(sid, sess, callback) {
        callback(new Error('boom!'))
      }

      server.on('error', function onerror(err) {
        assert.ok(err)
        assert.strictEqual(err.message, 'boom!')
        cb()
      })

      request(server)
      .get('/')
      .expect(200, 'session saved', cb)
    })

    it('should prevent uninitialized session from being touched', function (done) {
      const cb = after(1, done)
      const store = new MemoryStore()
      const server = createServer({ saveUninitialized: false, store: store, cookie: { maxAge: min } }, function (req:Request, res:Response) {
        res.end()
      })

      store.touch = function () {
        cb(new Error('should not be called'))
      }

      request(server)
      .get('/')
      .expect(200, cb)
    })
  });

  describe('secret option', function () {
    it('should reject empty arrays', function () {
      assert.throws(createServer.bind(null, { secret: [] }), /secret option array/);
    })

    describe('when an array', function () {
      it('should sign cookies', function (done) {
        const server = createServer({ secret: ['keyboard cat', 'nyan cat'] }, function (req:Request, res:Response) {
          req.session.user = 'bob';
          res.end(req.session.user);
        });

        request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'bob', done);
      })

      it('should sign cookies with first element', function (done) {
        const store = new MemoryStore();

        const server1 = createServer({ secret: ['keyboard cat', 'nyan cat'], store: store }, function (req:Request, res:Response) {
          req.session.user = 'bob';
          res.end(req.session.user);
        });

        const server2 = createServer({ secret: 'nyan cat', store: store }, function (req:Request, res:Response) {
          res.end(String(req.session.user));
        });

        request(server1)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'bob', function (err, res) {
          if (err) return done(err);
          request(server2)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, 'undefined', done);
        });
      });

      it('should read cookies using all elements', function (done) {
        const store = new MemoryStore();

        const server1 = createServer({ secret: 'nyan cat', store: store }, function (req:Request, res:Response) {
          req.session.user = 'bob';
          res.end(req.session.user);
        });

        const server2 = createServer({ secret: ['keyboard cat', 'nyan cat'], store: store }, function (req:Request, res:Response) {
          res.end(String(req.session.user));
        });

        request(server1)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'bob', function (err, res) {
          if (err) return done(err);
          request(server2)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, 'bob', done);
        });
      });
    })
  })

  describe('unset option', function () {
    it('should reject unknown values', function(){
      assert.throws(session.bind(null, { unset: 'bogus!' }), /unset.*must/)
    });

    it('should default to keep', function(done){
      const store = new MemoryStore();
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        req.session.count++
        if (req.session.count === 2) req.session = null
        res.end()
      })

      request(server)
      .get('/')
      .expect(200, function(err, res){
        if (err) return done(err);
        store.length(function(err, len){
          if (err) return done(err);
          assert.strictEqual(len, 1)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, function(err, res){
            if (err) return done(err);
            store.length(function(err, len){
              if (err) return done(err);
              assert.strictEqual(len, 1)
              done();
            });
          });
        });
      });
    });

    it('should allow destroy on req.session = null', function(done){
      const store = new MemoryStore();
      const server = createServer({ store: store, unset: 'destroy' }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        req.session.count++
        if (req.session.count === 2) req.session = null
        res.end()
      })

      request(server)
      .get('/')
      .expect(200, function(err, res){
        if (err) return done(err);
        store.length(function(err, len){
          if (err) return done(err);
          assert.strictEqual(len, 1)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, function(err, res){
            if (err) return done(err);
            store.length(function(err, len){
              if (err) return done(err);
              assert.strictEqual(len, 0)
              done();
            });
          });
        });
      });
    });

    it('should not set cookie if initial session destroyed', function(done){
      const store = new MemoryStore();
      const server = createServer({ store: store, unset: 'destroy' }, function (req:Request, res:Response) {
        req.session = null
        res.end()
      })

      request(server)
      .get('/')
      .expect(shouldNotHaveHeader('Set-Cookie'))
      .expect(200, function(err, res){
        if (err) return done(err);
        store.length(function(err, len){
          if (err) return done(err);
          assert.strictEqual(len, 0)
          done();
        });
      });
    });

    it('should pass session destroy error', function (done) {
      const cb = after(2, done)
      const store = new MemoryStore()
      const server = createServer({ store: store, unset: 'destroy' }, function (req:Request, res:Response) {
        req.session = null
        res.end('session destroyed')
      })

      store.destroy = function destroy(sid, callback) {
        callback(new Error('boom!'))
      }

      server.on('error', function onerror(err) {
        assert.ok(err)
        assert.strictEqual(err.message, 'boom!')
        cb()
      })

      request(server)
      .get('/')
      .expect(200, 'session destroyed', cb)
    })
  });

  describe('res.end patch', function () {
    it('should correctly handle res.end/res.write patched prior', function (done) {
      function setup (req:Request, res:Response) {
        writePatch(res)
      }

      function respond (req:Request, res:Response) {
        req.session.hit = true
        res.write('hello, ')
        res.end('world')
      }

      // @ts-ignore
      request(createServer(setup, null, respond))
      .get('/')
      .expect(200, 'hello, world', done)
    })

    it('should correctly handle res.end/res.write patched after', function (done) {
      function respond (req:Request, res:Response) {
        writePatch(res)
        req.session.hit = true
        res.write('hello, ')
        res.end('world')
      }

      request(createServer(null, respond))
      .get('/')
      .expect(200, 'hello, world', done)
    })

    it('should error when res.end is called twice', function (done) {
      let error1:Error|null = null
      let error2:Error|null = null
      const server = http.createServer(function (req:Request, res:Response) {
        res.end()

        try {
          res.setHeader('Content-Length', '3')
          res.end('foo')
        } catch (e:any) {
          error1 = e
        }
      })

      function respond (req: Request, res:Response) {
        res.end()

        try {
          res.setHeader('Content-Length', '3')
          res.end('foo')
        } catch (e) {
          error2 = e as Error
        }
      }

      request(server)
        .get('/')
        .end(function (err, res) {
          if (err) return done(err)
          request(createServer(null, respond))
            .get('/')
            .expect(function () { assert.strictEqual((error1 && error1.message), (error2 && error2.message)) })
            .expect(res.statusCode, res.text, done)
        })
    })
  })

  describe('req.session', function(){
    it('should persist', function(done){
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        req.session.count++
        res.end('hits: ' + req.session.count)
      })

      request(server)
      .get('/')
      .expect(200, 'hits: 1', function (err, res) {
        if (err) return done(err)
        store.load(sid(res), function (err: Error, sess:any) {
          if (err) return done(err)
          assert.ok(sess)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(200, 'hits: 2', done)
        })
      })
    })

    it('should only set-cookie when modified', function(done){
      let modify = true;
      const server = createServer(null, function (req:Request, res:Response) {
        if (modify) {
          req.session.count = req.session.count || 0
          req.session.count++
        }
        res.end(req.session.count.toString())
      })

      request(server)
      .get('/')
      .expect(200, '1', function (err, res) {
        if (err) return done(err)
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(200, '2', function (err, res) {
          if (err) return done(err)
          const val = cookie(res);
          modify = false;

          request(server)
          .get('/')
          .set('Cookie', val)
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, '2', function (err, res) {
            if (err) return done(err)
            modify = true;

            request(server)
            .get('/')
            .set('Cookie', val)
            .expect(shouldSetCookie('connect.sid'))
            .expect(200, '3', done)
          });
        });
      });
    })

    it('should not have enumerable methods', function (done) {
      const server = createServer(null, function (req:Request, res:Response) {
        req.session.foo = 'foo'
        req.session.bar = 'bar'
        const keys = []
        for (const key in req.session) {
          keys.push(key)
        }
        res.end(keys.sort().join(','))
      })

      request(server)
      .get('/')
      .expect(200, 'bar,cookie,foo', done);
    });

    it('should not be set if store is disconnected', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        res.end(typeof req.session)
      })

      store.emit('disconnect')

      request(server)
      .get('/')
      .expect(shouldNotHaveHeader('Set-Cookie'))
      .expect(200, 'undefined', done)
    })

    it('should be set when store reconnects', function (done) {
      const store = new MemoryStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        res.end(typeof req.session)
      })

      store.emit('disconnect')

      request(server)
      .get('/')
      .expect(shouldNotHaveHeader('Set-Cookie'))
      .expect(200, 'undefined', function (err) {
        if (err) return done(err)

        store.emit('connect')

        request(server)
        .get('/')
        .expect(200, 'object', done)
      })
    })

    describe('.destroy()', function(){
      it('should destroy the previous session', function(done){
        const server = createServer(null, function (req:Request, res:Response) {
          req.session.destroy(function (err:Error) {
            if (err) res.statusCode = 500
            res.end(String(req.session))
          })
        })

        request(server)
        .get('/')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, 'undefined', done)
      })
    })

    describe('.regenerate()', function(){
      it('should destroy/replace the previous session', function(done){
        const server = createServer(null, function (req:Request, res:Response) {
          const id = req.session.id
          req.session.regenerate(function (err:Error) {
            if (err) res.statusCode = 500
            res.end(String(req.session.id === id))
          })
        })

        request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetCookie('connect.sid'))
          .expect(shouldSetCookieToDifferentSessionId(sid(res)))
          .expect(200, 'false', done)
        });
      })
    })

    describe('.reload()', function () {
      it('should reload session from store', function (done) {
        const server = createServer(null, function (req:Request, res:Response) {
          if (req.url === '/') {
            req.session.active = true
            res.end('session created')
            return
          }

          req.session.url = req.url

          if (req.url === '/bar') {
            res.end('saw ' + req.session.url)
            return
          }

          request(server)
          .get('/bar')
          .set('Cookie', val)
          .expect(200, 'saw /bar', function (err, resp) {
            if (err) return done(err)
            req.session.reload(function (err:Error) {
              if (err) return done(err)
              res.end('saw ' + req.session.url)
            })
          })
        })
        let val:any

        request(server)
        .get('/')
        .expect(200, 'session created', function (err, res) {
          if (err) return done(err)
          val = cookie(res)
          request(server)
          .get('/foo')
          .set('Cookie', val)
          .expect(200, 'saw /bar', done)
        })
      })

      it('should error is session missing', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store }, function (req:Request, res:Response) {
          if (req.url === '/') {
            req.session.active = true
            res.end('session created')
            return
          }

          store.clear(function (err) {
            if (err) return done(err)
            req.session.reload(function (err:Error) {
              res.statusCode = err ? 500 : 200
              res.end(err ? err.message : '')
            })
          })
        })

        request(server)
        .get('/')
        .expect(200, 'session created', function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/foo')
          .set('Cookie', cookie(res))
          .expect(500, 'failed to load session', done)
        })
      })

      it('should not override an overriden `reload` in case of errors',  function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store, resave: false },
            function (req:Request, res:Response) {
          if (req.url === '/') {
            req.session.active = true
            res.end('session created')
            return
          }

          store.clear(function (err) {
            if (err) return done(err)

            // reload way too many times on top of each other,
            // attempting to overflow the call stack
            let iters = 20
            reload()
            function reload () {
              if (!--iters) {
                res.end('ok')
                return
              }

              try {
                req.session.reload(reload)
              } catch (e:any) {
                res.statusCode = 500
                res.end(e.message)
              }
            }
          })
        })

        request(server)
          .get('/')
          .expect(200, 'session created', function (err, res) {
            if (err) return done(err)
            request(server)
              .get('/foo')
              .set('Cookie', cookie(res))
              .expect(200, 'ok', done)
          })
      })
    })

    describe('.save()', function () {
      it('should save session to store', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store }, function (req:Request, res:Response) {
          req.session.hit = true
          req.session.save(function (err:Error) {
            if (err) return res.end(err.message)
            store.get(req.session.id, function (err, sess) {
              if (err) return res.end(err.message)
              res.end(sess ? 'stored' : 'empty')
            })
          })
        })

        request(server)
        .get('/')
        .expect(200, 'stored', done)
      })

      it('should prevent end-of-request save', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store }, function (req:Request, res:Response) {
          req.session.hit = true
          req.session.save(function (err:Error) {
            if (err) return res.end(err.message)
            res.end('saved')
          })
        })

        request(server)
        .get('/')
        .expect(shouldSetSessionInStore(store))
        .expect(200, 'saved', function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetSessionInStore(store))
          .expect(200, 'saved', done)
        })
      })

      it('should prevent end-of-request save on reloaded session', function (done) {
        const store = new MemoryStore()
        const server = createServer({ store: store }, function (req:Request, res:Response) {
          req.session.hit = true
          req.session.reload(function () {
            req.session.save(function (err:Error) {
              if (err) return res.end(err.message)
              res.end('saved')
            })
          })
        })

        request(server)
        .get('/')
        .expect(shouldSetSessionInStore(store))
        .expect(200, 'saved', function (err, res) {
          if (err) return done(err)
          request(server)
          .get('/')
          .set('Cookie', cookie(res))
          .expect(shouldSetSessionInStore(store))
          .expect(200, 'saved', done)
        })
      })

      describe('when saveUninitialized is false', function () {
        it('should prevent end-of-request save', function (done) {
          const store = new MemoryStore()
          const server = createServer({ saveUninitialized: false, store: store }, function (req:Request, res:Response) {
            req.session.hit = true
            req.session.save(function (err:Error) {
              if (err) return res.end(err.message)
              res.end('saved')
            })
          })

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, 'saved', function (err, res) {
              if (err) return done(err)
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetSessionInStore(store))
                .expect(200, 'saved', done)
            })
        })
      })
    })

    describe('.touch()', function () {
      it('should reset session expiration', function (done) {
        const store = new MemoryStore()
        const server = createServer({ resave: false, store: store, cookie: { maxAge: min } }, function (req:Request, res:Response) {
          req.session.hit = true
          req.session.touch()
          res.end()
        })

        request(server)
        .get('/')
        .expect(200, function (err, res) {
          if (err) return done(err)
          const id = sid(res)
          store.get(id, function (err, sess) {
            if (err) return done(err)
            const exp = new Date(sess.cookie.expires)
            setTimeout(function () {
              request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(200, function (err, res) {
                if (err) return done(err);
                store.get(id, function (err, sess) {
                  if (err) return done(err)
                  assert.notStrictEqual(new Date(sess.cookie.expires).getTime(), exp.getTime())
                  done()
                })
              })
            }, 100)
          })
        })
      })

      it('should call the callback asynchronously', function (done) {
        const server = createServer(null, function (req:Request, res:Response) {
          let i = 0;
          req.session.touch(function () {
            ++i;
            res.end();
          });
          assert.strictEqual(i, 0);
        });

        request(server)
        .get('/')
        .expect(200, done);
      });
    })

    describe('.cookie', function(){
      describe('.*', function(){
        it('should serialize as parameters', function(done){
          const server = createServer({ proxy: true }, function (req:Request, res:Response) {
            req.session.cookie.httpOnly = false
            req.session.cookie.secure = true
            res.end()
          })

          request(server)
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'HttpOnly'))
          .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
          .expect(200, done)
        })

        it('should default to a browser-session length cookie', function(done){
          request(createServer({ cookie: { path: '/admin' } }))
          .get('/admin')
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
          .expect(200, done)
        })

        it('should Set-Cookie only once for browser-session cookies', function(done){
          const server = createServer({ cookie: { path: '/admin' } })

          request(server)
          .get('/admin/foo')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, function (err, res) {
            if (err) return done(err)
            request(server)
            .get('/admin')
            .set('Cookie', cookie(res))
            .expect(shouldNotHaveHeader('Set-Cookie'))
            .expect(200, done)
          });
        })

        it('should override defaults', function(done){
          const server = createServer({ cookie:
                { path: '/admin', httpOnly: false, secure: true, maxAge: 5000 } },
              function (req:Request, res:Response) {
            req.session.cookie.secure = false
            res.end()
          })

          request(server)
          .get('/admin')
          .expect(shouldSetCookieWithAttribute('connect.sid', 'Expires'))
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'HttpOnly'))
          .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Path', '/admin'))
          .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
          .expect(200, done)
        })

        it('should preserve cookies set before writeHead is called', function(done){
          const server = createServer(null, function (req:Request, res:Response) {
            const cookie = new Cookie()
            res.setHeader('Set-Cookie', cookie.serialize('previous', 'cookieValue'))
            res.end()
          })

          request(server)
          .get('/')
          .expect(shouldSetCookieToValue('previous', 'cookieValue'))
          .expect(200, done)
        })

        it('should preserve cookies set in writeHead', function (done) {
          const server = createServer(null, function (req:Request, res:Response) {
            const cookie = new Cookie()
            res.writeHead(200, {
              'Set-Cookie': cookie.serialize('previous', 'cookieValue')
            })
            res.end()
          })

          request(server)
            .get('/')
            .expect(shouldSetCookieToValue('previous', 'cookieValue'))
            .expect(200, done)
        })
      })

      describe('.originalMaxAge', function () {
        it('should equal original maxAge', function (done) {
          const server = createServer({ cookie: { maxAge: 2000 } }, function (req:Request, res:Response) {
            res.end(JSON.stringify(req.session.cookie.originalMaxAge))
          })

          request(server)
            .get('/')
            .expect(200)
            .expect(function (res) {
              // account for 1ms latency
              assert.ok(res.text === '2000' || res.text === '1999',
                'expected 2000, got ' + res.text)
            })
            .end(done)
        })

        it('should equal original maxAge for all requests', function (done) {
          const server = createServer({ cookie: { maxAge: 2000 } }, function (req:Request, res:Response) {
            res.end(JSON.stringify(req.session.cookie.originalMaxAge))
          })

          request(server)
            .get('/')
            .expect(200)
            .expect(function (res) {
              // account for 1ms latency
              assert.ok(res.text === '2000' || res.text === '1999',
                'expected 2000, got ' + res.text)
            })
            .end(function (err, res) {
              if (err) return done(err)
              setTimeout(function () {
                request(server)
                  .get('/')
                  .set('Cookie', cookie(res))
                  .expect(200)
                  .expect(function (res) {
                    // account for 1ms latency
                    assert.ok(res.text === '2000' || res.text === '1999',
                      'expected 2000, got ' + res.text)
                  })
                  .end(done)
              }, 100)
            })
        })

        it('should equal original maxAge for all requests', function (done) {
          const store = new SmartStore()
          const server = createServer({ cookie: { maxAge: 2000 }, store: store }, function (req:Request, res:Response) {
            res.end(JSON.stringify(req.session.cookie.originalMaxAge))
          })

          request(server)
            .get('/')
            .expect(200)
            .expect(function (res) {
              // account for 1ms latency
              assert.ok(res.text === '2000' || res.text === '1999',
                'expected 2000, got ' + res.text)
            })
            .end(function (err, res) {
              if (err) return done(err)
              setTimeout(function () {
                request(server)
                  .get('/')
                  .set('Cookie', cookie(res))
                  .expect(200)
                  .expect(function (res) {
                    // account for 1ms latency
                    assert.ok(res.text === '2000' || res.text === '1999',
                      'expected 2000, got ' + res.text)
                  })
                  .end(done)
              }, 100)
            })
        })
      })

      describe('.secure', function(){
        let app: any

        before(function () {
          app = createRequestListener({ secret: 'keyboard cat', cookie: { secure: true } })
        })

        it('should set cookie when secure', function (done) {
          const cert = fs.readFileSync(__dirname + '/fixtures/server.crt', 'ascii')
          const server = https.createServer({
            key: fs.readFileSync(__dirname + '/fixtures/server.key', 'ascii'),
            cert: cert
          })

          server.on('request', app)

          const agent = new https.Agent({ca: cert})
          // @ts-ignore
          const createConnection = agent.createConnection

          // @ts-ignore
          agent.createConnection = function (options) {
            options.servername = 'express-session.local'
            return createConnection.call(this, options)
          }

          const req = request(server).get('/')
          req.agent(agent)
          req.expect(shouldSetCookie('connect.sid'))
          req.expect(200, done)
        })

        it('should not set-cookie when insecure', function(done){
          const server = http.createServer(app)

          request(server)
          .get('/')
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, done)
        })
      })

      describe('.maxAge', function () {
        before(function (done) {
          const ctx = this

          ctx.cookie = ''
          ctx.server = createServer({ cookie: { maxAge: 2000 } }, function (req:Request, res:Response) {
            switch (++req.session.count) {
              case 1:
                break
              case 2:
                req.session.cookie.maxAge = 5000
                break
              case 3:
                req.session.cookie.maxAge = 3000000000
                break
              default:
                req.session.count = 0
                break
            }
            res.end(req.session.count.toString())
          })

          request(ctx.server)
          .get('/')
          .end(function (err, res) {
            ctx.cookie = res && cookie(res)
            done(err)
          })
        })

        it('should set cookie expires relative to maxAge', function (done) {
          request(this.server)
          .get('/')
          .set('Cookie', this.cookie)
          .expect(shouldSetCookieToExpireIn('connect.sid', 2000))
          .expect(200, '1', done)
        })

        it('should modify cookie expires when changed', function (done) {
          request(this.server)
          .get('/')
          .set('Cookie', this.cookie)
          .expect(shouldSetCookieToExpireIn('connect.sid', 5000))
          .expect(200, '2', done)
        })

        it('should modify cookie expires when changed to large value', function (done) {
          request(this.server)
          .get('/')
          .set('Cookie', this.cookie)
          .expect(shouldSetCookieToExpireIn('connect.sid', 3000000000))
          .expect(200, '3', done)
        })
      })

      describe('.expires', function(){
        describe('when given a Date', function(){
          it('should set absolute', function(done){
            const server = createServer(null, function (req:Request, res:Response) {
              req.session.cookie.expires = new Date(0)
              res.end()
            })

            request(server)
            .get('/')
            .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Expires', 'Thu, 01 Jan 1970 00:00:00 GMT'))
            .expect(200, done)
          })
        })

        describe('when null', function(){
          it('should be a browser-session cookie', function(done){
            const server = createServer(null, function (req:Request, res:Response) {
              req.session.cookie.expires = null
              res.end()
            })

            request(server)
            .get('/')
            .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
            .expect(200, done)
          })

          it('should not reset cookie', function (done) {
            const server = createServer(null, function (req:Request, res:Response) {
              req.session.cookie.expires = null;
              res.end();
            });

            request(server)
            .get('/')
            .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(shouldNotHaveHeader('Set-Cookie'))
              .expect(200, done)
            });
          })

          it('should not reset cookie when modified', function (done) {
            const server = createServer(null, function (req:Request, res:Response) {
              req.session.cookie.expires = null;
              req.session.hit = (req.session.hit || 0) + 1;
              res.end();
            });

            request(server)
            .get('/')
            .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(shouldNotHaveHeader('Set-Cookie'))
              .expect(200, done)
            });
          })
        })
      })
    })
  })

  describe('synchronous store', function(){
    it('should respond correctly on save', function(done){
      const store = new SyncStore()
      const server = createServer({ store: store }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        req.session.count++
        res.end('hits: ' + req.session.count)
      })

      request(server)
      .get('/')
      .expect(200, 'hits: 1', done)
    })

    it('should respond correctly on destroy', function(done){
      const store = new SyncStore()
      const server = createServer({ store: store, unset: 'destroy' }, function (req:Request, res:Response) {
        req.session.count = req.session.count || 0
        let count = ++req.session.count
        if (req.session.count > 1) {
          req.session = null
          res.write('destroyed\n')
        }
        res.end('hits: ' + count)
      })

      request(server)
      .get('/')
      .expect(200, 'hits: 1', function (err, res) {
        if (err) return done(err)
        request(server)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(200, 'destroyed\nhits: 2', done)
      })
    })
  })

  describe('cookieParser()', function () {
    it('should read from req.cookies', function(done){
      const app = express()
        .use(cookieParser())
        .use(function(req, res, next){ req.headers.cookie = 'foo=bar'; next() })
        .use(createSession())
        .use(function(req:any, res, next){
          req.session.count = req.session.count || 0
          req.session.count++
          res.end(req.session.count.toString())
        })

      request(app)
      .get('/')
      .expect(200, '1', function (err, res) {
        if (err) return done(err)
        request(app)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(200, '2', done)
      })
    })

    it('should reject unsigned from req.cookies', function(done){
      const app = express()
        .use(cookieParser())
        .use(function(req, res, next){ req.headers.cookie = 'foo=bar'; next() })
        .use(createSession({ key: 'sessid' }))
        .use(function(req:any, res, next){
          req.session.count = req.session.count || 0
          req.session.count++
          res.end(req.session.count.toString())
        })

      request(app)
      .get('/')
      .expect(200, '1', function (err, res) {
        if (err) return done(err)
        request(app)
        .get('/')
        .set('Cookie', 'sessid=' + sid(res))
        .expect(200, '1', done)
      })
    })

    it('should reject invalid signature from req.cookies', function(done){
      const app = express()
        .use(cookieParser())
        .use(function(req, res, next){ req.headers.cookie = 'foo=bar'; next() })
        .use(createSession({ key: 'sessid' }))
        .use(function(req:any, res, next){
          req.session.count = req.session.count || 0
          req.session.count++
          res.end(req.session.count.toString())
        })

      request(app)
      .get('/')
      .expect(200, '1', function (err, res) {
        if (err) return done(err)
        const val = cookie(res).replace(/...\./, '.')
        request(app)
        .get('/')
        .set('Cookie', val)
        .expect(200, '1', done)
      })
    })

    it('should read from req.signedCookies', function(done){
      const app = express()
        .use(cookieParser('keyboard cat'))
        .use(function(req, res, next){ delete req.headers.cookie; next() })
        .use(createSession())
        .use(function(req:any, res, next){
          req.session.count = req.session.count || 0
          req.session.count++
          res.end(req.session.count.toString())
        })

      request(app)
      .get('/')
      .expect(200, '1', function (err, res) {
        if (err) return done(err)
        request(app)
        .get('/')
        .set('Cookie', cookie(res))
        .expect(200, '2', done)
      })
    })
  })
})

function cookie(res: any) {
  const setCookie = res.headers['set-cookie'];
  return (setCookie && setCookie[0]) || undefined;
}

function  createServer (options?:Options|null, respond?:any) {
  let fn = respond
  let opts = options
  let server = http.createServer()

  // setup, options, respond
  if (typeof arguments[0] === 'function') {
    opts = arguments[1]
    fn = arguments[2]

    server.on('request', arguments[0])
  }

  return server.on('request', createRequestListener(opts, fn))
}

const createRequestListener = (opts:Options, fn?: Function)=> {
  let _session = createSession(opts)
  let respond = fn || end

  return  (req: any, res: any)=> {
    const server = this

    _session(req, res as any, (err:any)=> {
      if (err && !res._header) {
        res.statusCode = err.status || 500
        res.end(err.message)
        return
      }

      if (err) {
        // @ts-ignore
        server.emit('error', err)
        return
      }

      respond(req, res)
    })
  }
}

const createSession = (opts?: Options)=> {
  const options:Options = opts || {}

  if (!('cookie' in options)) {
    options.cookie = { maxAge: 60 * 1000 }
  }

  if (!('secret' in options)) {
    options.secret = 'keyboard cat'
  }

  return session(options)
}

function end(req:Request, res: any) {
  res.end()
}

function expires (res:any) {
  const header = cookie(res)
  return header && parseSetCookie(header).expires
}

const  mountAt = (path:string)=> {
  return (req: any, res: any)=> {
    if (req.url.indexOf(path) === 0) {
      req.originalUrl = req.url
      req.url = req.url.slice(path.length)
    }
  }
}

function shouldNotHaveHeader(header: string) {
  return function (res:any) {
    assert.ok(!(header.toLowerCase() in res.headers), 'should not have ' + header + ' header')
  }
}

function shouldNotSetSessionInStore(store:any) {
  const _set = store.set
  let count = 0

  store.set = function set () {
    count++
    return _set.apply(this, arguments)
  }

  return function () {
    assert.ok(count === 0, 'should not set session in store')
  }
}

const shouldSetCookie = (name:string) => {
  return (res:string)=> {
    const header = cookie(res)
    console.log(header)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
  }
}

function shouldSetCookieToDifferentSessionId (id: string) {
  return function (res:any) {
    assert.notStrictEqual(sid(res), id)
  }
}

function shouldSetCookieToExpireIn (name:string, delta:number) {
  return function (res:any) {
    const header = cookie(res)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
    assert.ok(('expires' in data), 'should set cookie with attribute Expires')
    assert.ok(('date' in res.headers), 'should have a date header')
    assert.strictEqual((Date.parse(data.expires) - Date.parse(res.headers.date)),
        delta, 'should set cookie ' + name + ' to expire in ' + delta + ' ms')
  }
}

function shouldSetCookieToValue (name:string, val:string) {
  return function (res:Response) {
    const header = cookie(res)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
    assert.strictEqual(data.value, val, 'should set cookie ' + name + ' to ' + val)
  }
}

function shouldSetCookieWithAttribute (name:string, attrib:string) {
  return function (res:Response) {
    const header = cookie(res)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
    assert.ok((attrib.toLowerCase() in data), 'should set cookie with attribute ' + attrib)
  }
}

function shouldSetCookieWithAttributeAndValue (name:string, attrib:string, value:string) {
  return function (res:Response) {
    const header = cookie(res)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
    assert.ok((attrib.toLowerCase() in data), 'should set cookie with attribute ' + attrib)
    assert.strictEqual(data[attrib.toLowerCase()], value, 'should set cookie with attribute ' + attrib + ' set to ' + value)
  }
}

function shouldSetCookieWithoutAttribute (name:string, attrib:string) {
  return function (res:Response) {
    const header = cookie(res)
    const data = header && parseSetCookie(header)
    assert.ok(header, 'should have a cookie header')
    assert.strictEqual(data.name, name, 'should set cookie ' + name)
    assert.ok(!(attrib.toLowerCase() in data), 'should set cookie without attribute ' + attrib)
  }
}

function shouldSetSessionInStore (store: any, delay?: number) {
  const _set = store.set
  let count = 0

  store.set = function set () {
    count++

    if (!delay) {
      // @ts-ignore
      return _set.apply(this, arguments)
    }

    const args = new Array(arguments.length + 1)

    args[0] = this
    for (let i = 1; i < args.length; i++) {
      args[i] = arguments[i - 1]
    }

    // @ts-ignore
    setTimeout(_set.bind.apply(_set, args), delay)
  }

  return function () {
    assert.ok(count === 1, 'should set session in store')
  }
}

function sid (res: Response) {
  const header = cookie(res)
  const data = header && parseSetCookie(header)
  const value = data && unescape(data.value)
  const sid = value && value.substring(2, value.indexOf('.'))
  return sid || undefined
}
