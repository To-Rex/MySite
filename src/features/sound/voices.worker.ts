import { BANKS, VOICES, type BankName, type VoiceName } from './voices'

/**
 * Renders the voices away from the page. About a second of arithmetic on a
 * laptop and several on a phone, which on the main thread would be visible as a
 * stall in the 3D. A page asks for its bank and the voices come back one by one,
 * in the bank's order, so whatever is heard first is ready first.
 */

export interface VoiceRequest {
  bank: BankName
}

export interface VoiceMessage {
  name: VoiceName
  channels: Float32Array[]
}

/** The app compiles against the DOM lib, where `self` is typed as a Window. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<VoiceRequest>) => void) | null
  postMessage(message: VoiceMessage, transfer: Transferable[]): void
}

scope.onmessage = (event) => {
  for (const name of BANKS[event.data.bank]) {
    const channels = VOICES[name]()
    scope.postMessage(
      { name, channels },
      channels.map((channel) => channel.buffer as ArrayBuffer),
    )
  }
}
