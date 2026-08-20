import { Environment, Lightformer } from '@react-three/drei'
import type { Theme } from '@/theme/context'

/**
 * Procedural studio lighting shared by every scene — no external HDRI downloads.
 * Dark: dramatic rim strips with a warm key. Light: large soft boxes with bounce.
 * `key={theme}` forces a re-bake when the theme changes (frames=1 bakes once).
 */
export function ThemedEnvironment({ theme, resolution }: { theme: Theme; resolution: number }) {
  return (
    <Environment key={theme} resolution={resolution} frames={1}>
      {theme === 'dark' ? (
        <>
          <Lightformer intensity={3} form="rect" position={[0, 4, -2]} scale={[7, 1.1, 1]} color="#ffffff" />
          <Lightformer intensity={1.6} form="rect" position={[-5, 1.2, 2]} scale={[3.5, 1, 1]} color="#e4cfa8" />
          <Lightformer intensity={0.9} form="rect" position={[5, -1, 2]} scale={[3.5, 2.4, 1]} color="#9aa0a8" />
          <Lightformer intensity={0.6} form="ring" position={[0, -3.5, 3]} scale={3} color="#ffffff" />
        </>
      ) : (
        <>
          <Lightformer intensity={1.7} form="rect" position={[0, 5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[9, 9, 1]} color="#ffffff" />
          <Lightformer intensity={1} form="rect" position={[-4.5, 1, 3]} scale={[3, 4, 1]} color="#fff4e3" />
          <Lightformer intensity={0.7} form="rect" position={[4.5, 0.5, 3]} scale={[3, 4, 1]} color="#e9eef3" />
          <Lightformer intensity={0.5} form="rect" position={[0, -4.5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 9, 1]} color="#e6e0d4" />
        </>
      )}
    </Environment>
  )
}
