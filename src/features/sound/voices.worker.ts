import { VOICES, VOICE_NAMES, type VoiceName } from './voices'

/**
 * Renders the voices away from the page. About a second of arithmetic on a
 * laptop and several on a phone, which on the main thread would be visible as a
 * stall in the 3D. Voices are posted one by one, most important first, so the
 * roar is ready long before the last pebble.
 */

export interface VoiceMessage {
  name: VoiceName
  channels: Float32Array[]
}

/** The app compiles against the DOM lib, where `self` is typed as a Window. */
const scope = self as unknown as { postMessage(message: VoiceMessage, transfer: Transferable[]): void }

for (const name of VOICE_NAMES) {
  const channels = VOICES[name]()
  scope.postMessage(
    { name, channels },
    channels.map((channel) => channel.buffer as ArrayBuffer),
  )
}
