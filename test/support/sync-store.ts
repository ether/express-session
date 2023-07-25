import Store from "../../session/store";

class SyncStore extends Store {
    private readonly sessions: any;
    constructor() {
        // @ts-ignore
      super()
      this.sessions = Object.create(null)
    }

    // @ts-ignore
    destroy(sid: string, callback: Function) {
        delete this.sessions[sid]
        callback()
    }

    get(sid: string, callback: Function) {
        callback(null, JSON.parse(this.sessions[sid]))
    }

    set(sid: string, sess: any, callback: Function) {
        this.sessions[sid] = JSON.stringify(sess)
        callback()
    }
}

export default SyncStore
