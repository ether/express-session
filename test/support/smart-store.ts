
import Store from "../../session/store";

type DerefFunctionType = (...args: any) => void
/* istanbul ignore next */
const defer:DerefFunctionType = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn: DerefFunctionType){ // @ts-ignore
      process.nextTick(fn.bind.apply(fn, arguments)) }


export default class SmartStore extends Store {
    private readonly sessions: any;
    constructor() {
        // @ts-ignore
        super()
        this.sessions = Object.create(null)
    }

    // @ts-ignore
    destroy(sid: string, callback: DerefFunctionType) {
        delete this.sessions[sid]
        defer(callback)
    }

    get(sid: string, callback: DerefFunctionType) {
        let sess = this.sessions[sid]

        if (!sess) {
        return
        }

        // parse
        sess = JSON.parse(sess)

        if (sess.cookie) {
        // expand expires into Date object
        sess.cookie.expires = typeof sess.cookie.expires === 'string'
            ? new Date(sess.cookie.expires)
            : sess.cookie.expires

        // destroy expired session
        if (sess.cookie.expires && sess.cookie.expires <= Date.now()) {
            delete this.sessions[sid]
            sess = null
        }
        }

        defer(callback, null, sess)
    }

    set(sid: string, sess: any, callback: DerefFunctionType) {
        this.sessions[sid] = JSON.stringify(sess)
        defer(callback)
    }
}
