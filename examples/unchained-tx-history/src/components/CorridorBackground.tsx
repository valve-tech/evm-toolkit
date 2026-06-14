/**
 * The graffiti alley, drawn on a single <canvas>.
 *
 * Why canvas and not CSS 3D: a deep, dense, animated perspective corridor means
 * large 3D-transformed surfaces and hundreds of shadowed text nodes — which
 * blow past GPU compositing-layer/texture limits and stutter. Here it's one
 * element: we project each brick line and tag from its corridor DEPTH to the
 * screen and redraw per frame. Walking forward = advancing depth.
 *
 * Perf: every tag is rasterised ONCE to an offscreen sprite, then drawn each
 * frame with a single (cheap) drawImage — never re-shaping text per frame.
 *
 * The flat sky/asphalt backdrop and the focal fog stay as cheap CSS layers
 * behind/over this canvas (`.backdrop` / `.vanish`); the canvas paints only the
 * two side walls, leaving the sky/ground triangles transparent.
 */
import { useEffect, useRef } from 'react'

const SPRAY = ['#ff2d95', '#00e5ff', '#ffe600', '#39ff14', '#ff6b00', '#b14bff', '#ff1744', '#18ffff', '#ff9f1c']
const FONTS = [
  '"Permanent Marker"',
  '"Bangers"',
  '"Bungee"',
  '"Kaushan Script"',
  '"Rock Salt"',
  '"Yellowtail"',
  '"Marck Script"',
  '"Caveat Brush"',
  '"Sigmar One"',
]
const WORDS = ['TAGGED', 'PULSE', '0xF4D2', 'MINT', 'SWAP', 'ON-CHAIN', 'DEGEN', 'WAGMI', 'tag', 'VALVE', 'HODL', 'BURN', 'APE', 'gm', 'wreck', 'flow', 'tags', '0xDEAD', 'wall', '369', 'spray', 'chain', '0x00…', 'ser', 'bag', 'wgmi']

const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]

const FOCAL = 6 // perspective: screen scale = FOCAL / (FOCAL + z). High = gentle
// falloff, so tags barely change size across the corridor and read as one wall
// sliding past (only ~1.1× at the very edge — no jarring zoom or grow/slide split).
const ZMAX = 8 // depth (world units) a tag spans before recycling to the far end
const Z_EXIT = -0.7 // slide just past the edge (off the viewport), then recycle
const TAG_COUNT = 190
const SPEED = 0.8 // world units / second — a slow walk
const SPRITE_REF = 128 // font px each sprite is rasterised at, then scaled when drawn

interface Sprite {
  canvas: HTMLCanvasElement
  w: number
  h: number
}

interface Tag {
  /** Depth: large = far (horizon), 0 = at the viewer, negative = slid past you. */
  z: number
  /** Height on the wall, 0 (bottom) … 1 (top). */
  h: number
  /** Wall: -1 left, +1 right. */
  side: -1 | 1
  size: number
  rot: number
  sprite: Sprite
}

/** Rasterise one tag word to an offscreen canvas once, at the reference size. */
const renderSprite = (word: string, font: string, color: string, stroke: boolean): Sprite => {
  const c = document.createElement('canvas')
  const cx = c.getContext('2d')
  if (!cx) return { canvas: c, w: 1, h: 1 }
  cx.font = `${SPRITE_REF}px ${font}, cursive`
  const pad = SPRITE_REF * 0.35 // headroom for tall faces + stroke
  const w = Math.ceil(cx.measureText(word).width + pad * 2)
  const h = Math.ceil(SPRITE_REF * 1.8)
  c.width = w
  c.height = h
  cx.font = `${SPRITE_REF}px ${font}, cursive` // resizing the canvas resets the context
  cx.textAlign = 'center'
  cx.textBaseline = 'middle'
  if (stroke) {
    cx.lineWidth = SPRITE_REF * 0.05
    cx.strokeStyle = color
    cx.strokeText(word, w / 2, h / 2)
  } else {
    cx.fillStyle = color
    cx.fillText(word, w / 2, h / 2)
  }
  return { canvas: c, w, h }
}

const makeTag = (z: number): Tag => ({
  z,
  h: Math.random(),
  side: Math.random() < 0.5 ? -1 : 1,
  size: 46 + Math.random() * 130,
  // Only a slight hand-painted jitter — the wall shear supplies each tag's
  // real angle, so a big random spin just reads as noise.
  rot: (Math.random() * 8 - 4) * (Math.PI / 180),
  sprite: renderSprite(pick(WORDS), pick(FONTS), pick(SPRAY), Math.random() < 0.4),
})

export const CorridorBackground = () => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Theme-driven brick/mortar colours, re-read when the theme toggles.
    let brick = '#1b1c23'
    let mortar = '#15141a'
    const readTheme = (): void => {
      const cs = getComputedStyle(document.documentElement)
      brick = cs.getPropertyValue('--brick').trim() || brick
      mortar = cs.getPropertyValue('--mortar').trim() || mortar
    }
    readTheme()
    const themeObs = new MutationObserver(readTheme)
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    let W = 0
    let H = 0
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      W = rect.width
      H = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) // bg art — full retina isn't worth it
      canvas.width = Math.max(1, Math.round(W * dpr))
      canvas.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let tags: Tag[] = []
    let brickPhase = 0

    // One side wall: an edge-on plane from the viewport edge (near, full height)
    // converging to the vanishing point. Filled red brick, then a RUNNING-BOND
    // mortar pattern — horizontal courses (converging lines) plus vertical
    // brick-ends that are offset half a brick on alternate courses (so it reads
    // as a staggered brick stack, not a grid). The brick-ends scroll toward the
    // viewer. All lines batched into one stroke for speed.
    const drawWall = (side: -1 | 1, vpx: number, vpy: number, over: number): void => {
      const nearX = side < 0 ? 0 : W
      const topNear = -over
      const botNear = H + over

      ctx.beginPath()
      ctx.moveTo(nearX, topNear)
      ctx.lineTo(nearX, botNear)
      ctx.lineTo(vpx, vpy)
      ctx.closePath()
      ctx.fillStyle = brick
      ctx.fill()

      const projX = (z: number): number => nearX + (vpx - nearX) * (z / (z + FOCAL))
      const projY = (z: number, h: number): number => {
        const t = z / (z + FOCAL)
        const ty = topNear + (vpy - topNear) * t
        const by = botNear + (vpy - botNear) * t
        return by + (ty - by) * h
      }

      const COURSES = 13
      const dz = 0.8
      ctx.strokeStyle = mortar
      ctx.lineWidth = 1
      ctx.globalAlpha = 1
      ctx.beginPath()
      // horizontal courses — every course line runs to the vanishing point
      for (let k = 1; k < COURSES; k++) {
        ctx.moveTo(nearX, projY(0, k / COURSES))
        ctx.lineTo(vpx, vpy)
      }
      // vertical brick-ends, half-brick-staggered on alternate courses
      for (let k = 0; k < COURSES; k++) {
        const h0 = k / COURSES
        const h1 = (k + 1) / COURSES
        const off = (k % 2) * (dz / 2)
        for (let z = dz - ((brickPhase + off) % dz); z < ZMAX; z += dz) {
          const sx = projX(z)
          ctx.moveTo(sx, projY(z, h0))
          ctx.lineTo(sx, projY(z, h1))
        }
      }
      ctx.stroke()
    }

    const drawTag = (tg: Tag, vpx: number, vpy: number, over: number): void => {
      const t = tg.z / (tg.z + FOCAL)
      const nearX = tg.side < 0 ? 0 : W
      const sx = nearX + (vpx - nearX) * t
      const topY = -over + (vpy - -over) * t
      const botY = H + over + (vpy - (H + over)) * t
      const sy = botY + (topY - botY) * tg.h
      const scale = FOCAL / (FOCAL + tg.z)
      const size = tg.size * scale
      if (size < 2) return
      const ds = size / SPRITE_REF
      const sp = tg.sprite
      // The tag lies ON the wall, not flat to the camera. The wall's "depth"
      // axis (the direction the corridor recedes) projects to this screen
      // vector — roughly horizontal, tilting toward the vanishing point, more
      // steeply near the top/bottom of the wall. We draw the sprite's x-axis
      // along it (and y straight down), which shears the word onto the wall.
      const dx = vpx - nearX
      const dy = (vpy - (H + over)) * (1 - tg.h) + (vpy + over) * tg.h
      const dl = Math.hypot(dx, dy) || 1
      // The wall's DEPTH axis foreshortens faster (∝ scale²) than its height
      // (∝ scale) — the corridor recedes away from you while the wall height
      // doesn't. Giving the word's horizontal axis the extra `scale` lays it
      // flat ON the wall plane instead of standing proud of it (which read as
      // parallax). Vertical axis keeps the plain height foreshortening (ds).
      const exMag = ds * scale
      ctx.save()
      ctx.globalAlpha = Math.min(0.9, scale * 1.5) // far end dissolves into the horizon fog
      ctx.translate(sx, sy)
      ctx.transform((dx / dl) * exMag, (dy / dl) * exMag, 0, ds, 0, 0)
      ctx.rotate(tg.rot)
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h)
      ctx.restore()
    }

    let raf = 0
    let prev = 0
    let alive = true
    const frame = (now: number): void => {
      if (!alive) return
      const dt = prev ? Math.min((now - prev) / 1000, 0.05) : 0
      prev = now
      const vpx = W * 0.5
      const vpy = H * 0.44 // horizon — matches the CSS backdrop split + focal fog
      const over = H * 0.6
      if (!reduce) {
        brickPhase += SPEED * dt
        for (const tg of tags) {
          tg.z -= SPEED * dt
          // Let it slide off the viewport edge before recycling to the far end.
          if (tg.z <= Z_EXIT) Object.assign(tg, makeTag(ZMAX))
        }
      }
      ctx.clearRect(0, 0, W, H)
      drawWall(-1, vpx, vpy, over)
      drawWall(1, vpx, vpy, over)
      // far → near so nearer tags paint over farther ones
      const order = [...tags].sort((a, b) => b.z - a.z)
      for (const tg of order) drawTag(tg, vpx, vpy, over)
      raf = requestAnimationFrame(frame)
    }

    // Build the tags (and their sprites) once the graffiti fonts are loaded, so
    // sprites aren't rasterised in a fallback face; then start the loop.
    void document.fonts.ready.then(() => {
      if (!alive) return
      tags = Array.from({ length: TAG_COUNT }, () => makeTag(Math.random() * (ZMAX - Z_EXIT) + Z_EXIT))
      raf = requestAnimationFrame(frame)
    })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      themeObs.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="corridor" aria-hidden="true" />
}
