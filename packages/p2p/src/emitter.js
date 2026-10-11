// Tiny emitter so this package has no Node-only dependencies.
export class Emitter {
  #l = new Map();
  on(ev, fn) { (this.#l.get(ev) || this.#l.set(ev, new Set()).get(ev)).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.#l.get(ev)?.delete(fn); }
  once(ev, fn) { const off = this.on(ev, (...a) => { off(); fn(...a); }); return off; }
  emit(ev, ...a) { for (const f of [...(this.#l.get(ev) || [])]) { try { f(...a); } catch (e) { console.error('[p2p]', e); } } }
}
