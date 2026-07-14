import {
  parseXFeedMonitorState,
  type XFeedMonitorState,
  type XFeedMonitorStore,
} from './monitor.js'

export interface MemoryXFeedMonitorStore extends XFeedMonitorStore {
  inspect(): XFeedMonitorState | null
  clear(): void
}

export function createMemoryXFeedMonitorStore(
  initial?: XFeedMonitorState,
): MemoryXFeedMonitorStore {
  let state = initial ? cloneState(initial) : null

  return {
    async read() {
      return state ? cloneState(state) : null
    },
    async write(nextState) {
      const parsed = parseXFeedMonitorState(nextState)
      if (!parsed) {
        throw new TypeError('Memory monitor store received invalid state.')
      }
      state = cloneState(parsed)
    },
    inspect() {
      return state ? cloneState(state) : null
    },
    clear() {
      state = null
    },
  }
}

function cloneState(state: XFeedMonitorState): XFeedMonitorState {
  return structuredClone(state)
}
