import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate'
import { getStroke } from 'perfect-freehand'
import simplify from 'simplify-js'
import './style.css'

type Tool = 'pen' | 'pencil' | 'brush'
type Point = [number, number, number]
type Stroke = { tool: Tool; color: number; points: Point[] }
type Note = { v: 1; from: string; strokes: Stroke[]; layout?: 'page' | 'spread'; aspect?: number }

const COLORS = ['#174c92', '#17191d', '#b62929', '#1d6a43']
const MAX_BYTES = 2000
const TARGET_BYTES = 1500
const STORAGE_KEY = 'book-pass-draft'
const app = document.querySelector<HTMLElement>('#app')!
const SCHOOL_DETAILS = (() => {
  const saved = sessionStorage.getItem('book-pass-school-details')
  if (saved) {
    try { return JSON.parse(saved) as { school: string; className: string; roll: number; house: string } }
    catch { sessionStorage.removeItem('book-pass-school-details') }
  }
  const pick = <T,>(values: T[]) => values[Math.floor(Math.random() * values.length)]
  const details = {
    school: pick(['SARASWATI VIDYA MANDIR', 'ZILLA PARISHAD HIGH SCHOOL', 'ST. MARY\'S CONVENT SCHOOL', 'NEW ENGLISH SCHOOL']),
    className: `${pick(['VI', 'VII', 'VIII', 'IX', 'X'])}-${pick(['A', 'B', 'C'])}`,
    roll: Math.floor(Math.random() * 48) + 1,
    house: pick(['ASHOKA', 'TAGORE', 'NEHRU', 'SHIVAJI']),
  }
  sessionStorage.setItem('book-pass-school-details', JSON.stringify(details))
  return details
})()

let strokes: Stroke[] = []
let active: Stroke | null = null
let tool: Tool = 'pen'
let color = 0
let sender = localStorage.getItem('book-pass-name') ?? ''
let replyTo = ''
let pageFull = false
let stylusSeen = false
let undoCount = 0

function encode(note: Note) {
  const bytes = zlibSync(strToU8(JSON.stringify(note)), { level: 9 })
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decode(value: string): Note | null {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4)
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
    const note = JSON.parse(strFromU8(unzlibSync(bytes))) as Note
    return note.v === 1 && Array.isArray(note.strokes) ? note : null
  } catch {
    return null
  }
}

const codecCheck: Note = { v: 1, from: 'test', strokes: [{ tool: 'pen', color: 0, points: [[.1, .2, .5]] }] }
if (JSON.stringify(decode(encode(codecCheck))) !== JSON.stringify(codecCheck)) throw new Error('Note codec self-check failed')

function payloadBytes(next = strokes) {
  return zlibSync(strToU8(JSON.stringify({ v: 1, from: sender, strokes: next, layout: currentLayout(), aspect: currentAspect() })), { level: 9 }).length
}

function currentLayout(): Note['layout'] {
  return matchMedia('(min-width: 701px)').matches ? 'spread' : 'page'
}

function currentAspect() {
  const canvas = app.querySelector<HTMLCanvasElement>('#paper')
  return canvas ? +(canvas.clientWidth / canvas.clientHeight).toFixed(3) : 1
}

function path(points: number[][]) {
  if (points.length < 3) return ''
  return points.reduce((d, [x, y], i) => `${d}${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`, '') + 'Z'
}

function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, partial = 1) {
  const config = {
    pen: { size: 4.8, thinning: 0.45, smoothing: 0.72, streamline: 0.58, opacity: 0.95 },
    pencil: { size: 7, thinning: 0.65, smoothing: 0.5, streamline: 0.45, opacity: 0.42 },
    brush: { size: 15, thinning: 0.18, smoothing: 0.78, streamline: 0.62, opacity: 0.76 },
  }[stroke.tool]
  const source = stroke.points.slice(0, Math.max(1, Math.ceil(stroke.points.length * partial)))
  const outline = getStroke(source.map(([x, y, p]) => [x * width, y * height, p]), {
    size: config.size,
    thinning: config.thinning,
    smoothing: config.smoothing,
    streamline: config.streamline,
    simulatePressure: false,
    easing: t => t,
    start: { taper: stroke.tool === 'brush' ? 0 : 4, cap: true },
    end: { taper: stroke.tool === 'brush' ? 0 : 7, cap: true },
  })
  const shape = new Path2D(path(outline))
  ctx.save()
  ctx.globalAlpha = config.opacity
  ctx.fillStyle = COLORS[stroke.color]
  ctx.fill(shape)
  if (stroke.tool === 'pencil') {
    ctx.globalAlpha = 0.12
    ctx.translate(0.7, 0.5)
    ctx.fill(shape)
  }
  ctx.restore()
}

function redraw(canvas: HTMLCanvasElement, list = strokes) {
  const dpr = Math.min(devicePixelRatio, 2)
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr
    canvas.height = height * dpr
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  for (const stroke of list) renderStroke(ctx, stroke, width, height)
  if (active) renderStroke(ctx, active, width, height)
}

function cover(isReply = false) {
  app.innerHTML = `
    <section class="desk">
      <div class="sunbeam" aria-hidden="true"></div>
      <div class="fan-shadow" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="book-stage">
        <div class="cover-page-underlay" aria-hidden="true"></div>
        <div class="cover ${isReply ? 'reply-cover' : ''}">
          <span class="cover-edition">STANDARD LONG NOTEBOOK · 192 PAGES</span>
          <div class="identity-slip">
            <p><span>SCHOOL</span><strong>${SCHOOL_DETAILS.school}</strong></p>
            <label class="name-label"><span>Name:</span><input id="name" maxlength="28" autocomplete="name" value="${escapeHtml(sender)}" autofocus /></label>
            <div class="student-meta">
              <p><span>CLASS</span><b>${SCHOOL_DETAILS.className}</b></p>
              <p><span>ROLL NO.</span><b>${SCHOOL_DETAILS.roll}</b></p>
              <p><span>HOUSE</span><b>${SCHOOL_DETAILS.house}</b></p>
            </div>
          </div>
          <div class="cover-brand"><strong>BOOK<br>PASS</strong><small>पर्ची</small></div>
          <span class="cover-stamp">ROUGH<br>BOOK</span>
          <button class="open-book" type="button">OPEN <span>→</span></button>
        </div>
      </div>
    </section>`
  const input = app.querySelector<HTMLInputElement>('#name')!
  const desk = app.querySelector<HTMLElement>('.desk')!
  desk.addEventListener('pointermove', event => {
    const x = event.clientX / innerWidth - .5
    const y = event.clientY / innerHeight - .5
    desk.style.setProperty('--rx', `${(-y * 4).toFixed(2)}deg`)
    desk.style.setProperty('--ry', `${(x * 5).toFixed(2)}deg`)
  })
  desk.addEventListener('pointerleave', () => desk.removeAttribute('style'))
  const open = () => {
    sender = input.value.trim() || 'someone'
    localStorage.setItem('book-pass-name', sender)
    const coverElement = app.querySelector<HTMLElement>('.cover')!
    coverElement.addEventListener('animationend', event => {
      if (event.animationName === 'openCover') drawPage(true)
    }, { once: true })
    coverElement.classList.add('opening')
  }
  app.querySelector('button')!.addEventListener('click', open)
  input.addEventListener('keydown', event => event.key === 'Enter' && open())
}

function escapeHtml(value: string) {
  const node = document.createElement('span')
  node.textContent = value
  return node.innerHTML
}

function drawPage(opening = false) {
  const saved = sessionStorage.getItem(STORAGE_KEY)
  if (!strokes.length && saved) {
    try { strokes = JSON.parse(saved) as Stroke[] } catch { /* old draft, ignore */ }
  }
  app.innerHTML = `
    <section class="notebook-shell ${opening ? 'opening-desk' : ''}">
      <div class="notebook ${opening ? 'opening-spread' : ''}">
        <div class="page page-left" aria-hidden="true"><span class="spread-title">DO NOT READ</span><span class="page-number">12</span></div>
        <div class="page page-right">
          <div class="ink-status" aria-live="polite"></div>
          <aside class="limit-note" role="status">PAGE FULL.<strong>pass the note now.</strong></aside>
          <span class="page-number">13</span>
          <button class="pass" type="button" aria-label="Pass this note"><span>pass it</span></button>
        </div>
        <canvas id="paper" class="draw-surface" aria-label="Draw your note here"></canvas>
        <div class="fold-layer" aria-hidden="true"><span>passed.</span></div>
      </div>
      <nav class="tools" aria-label="Drawing tools">
        ${(['pen', 'pencil', 'brush'] as Tool[]).map(value => `<button data-tool="${value}" class="${tool === value ? 'selected' : ''}" aria-label="${value}"></button>`).join('')}
        <button data-action="undo" aria-label="Undo"></button>
        <div class="colours" aria-label="Ink colour">
          ${COLORS.map((_, index) => `<button data-colour="${index}" class="${color === index ? 'selected' : ''}" aria-label="${['Blue', 'Black', 'Red', 'Green'][index]}"></button>`).join('')}
        </div>
      </nav>
    </section>`

  const canvas = app.querySelector<HTMLCanvasElement>('#paper')!
  if (opening) {
    const notebook = app.querySelector<HTMLElement>('.notebook')!
    notebook.addEventListener('animationend', event => {
      if (event.target !== notebook || event.animationName !== 'spreadSettle') return
      notebook.classList.remove('opening-spread')
      app.querySelector('.notebook-shell')!.classList.remove('opening-desk')
    })
  }
  const ink = app.querySelector<HTMLElement>('.ink-status')!
  const page = app.querySelector<HTMLElement>('.page-right')!
  const passButton = app.querySelector<HTMLButtonElement>('.pass')!
  const limitNote = app.querySelector<HTMLElement>('.limit-note')!
  const showLimitNote = () => {
    limitNote.classList.remove('show')
    void limitNote.offsetWidth
    limitNote.classList.add('show')
  }
  const setPageFull = (full: boolean) => {
    pageFull = full
    page.classList.toggle('full', full)
    passButton.classList.toggle('pulse', full)
    passButton.querySelector('span')!.textContent = full ? 'PASS NOW' : 'pass it'
  }
  const updateInk = () => {
    const used = payloadBytes()
    ink.textContent = pageFull ? 'PAGE FULL' : used > TARGET_BYTES ? 'running out of page…' : ''
    ink.classList.toggle('near-full', used > TARGET_BYTES)
  }
  const point = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return [
      +((event.clientX - rect.left) / rect.width).toFixed(3),
      +((event.clientY - rect.top) / rect.height).toFixed(3),
      +(event.pressure || 0.5).toFixed(2),
    ]
  }

  canvas.addEventListener('pointerdown', event => {
    if (pageFull) {
      showLimitNote()
      return
    }
    if (event.button !== 0) return
    if (event.pointerType === 'pen') stylusSeen = true
    if (stylusSeen && event.pointerType === 'touch') return
    canvas.setPointerCapture(event.pointerId)
    active = { tool, color, points: [point(event)] }
    redraw(canvas)
  })
  canvas.addEventListener('pointermove', event => {
    if (!active || !canvas.hasPointerCapture(event.pointerId)) return
    for (const sample of event.getCoalescedEvents?.() ?? [event]) active.points.push(point(sample))
    redraw(canvas)
  })
  const finish = (event: PointerEvent) => {
    if (!active) return
    const rect = canvas.getBoundingClientRect()
    const raw = active.points
    const simplified = simplify(raw.map(([x, y, p]) => ({ x: x * rect.width, y: y * rect.height, p })), .5, true)
    active.points = simplified.map(({ x, y, p }) => [+(x / rect.width).toFixed(3), +(y / rect.height).toFixed(3), +p.toFixed(2)])
    const next = [...strokes, active]
    if (payloadBytes(next) > MAX_BYTES) {
      setPageFull(true)
      showLimitNote()
    } else {
      strokes = next
      undoCount = 0
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(strokes))
    }
    active = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    redraw(canvas)
    updateInk()
  }
  canvas.addEventListener('pointerup', finish)
  canvas.addEventListener('pointercancel', finish)

  app.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => {
    tool = button.dataset.tool as Tool
    app.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('selected', item === button))
  }))
  app.querySelectorAll<HTMLButtonElement>('[data-colour]').forEach(button => button.addEventListener('click', () => {
    color = Number(button.dataset.colour)
    app.querySelectorAll('[data-colour]').forEach(item => item.classList.toggle('selected', item === button))
  }))
  app.querySelector<HTMLButtonElement>('[data-action="undo"]')!.addEventListener('click', () => {
    if (!strokes.length || undoCount >= 20) return
    strokes.pop()
    undoCount++
    setPageFull(false)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(strokes))
    redraw(canvas)
    updateInk()
  })
  passButton.addEventListener('click', () => passNote())
  const observer = new ResizeObserver(() => redraw(canvas))
  observer.observe(canvas)
  redraw(canvas)
  updateInk()
}

function passNote() {
  if (!strokes.length) return
  const notebook = app.querySelector('.notebook')!
  notebook.classList.add('folding')
  setTimeout(() => {
    const fragment = encode({ v: 1, from: sender, strokes, layout: currentLayout(), aspect: currentAspect() })
    const url = `${location.origin}${location.pathname}#${fragment}`
    notebook.classList.remove('folding')
    app.insertAdjacentHTML('beforeend', `
      <div class="sheet-backdrop">
        <section class="pass-sheet" aria-label="Pass your note">
          <div class="sheet-grab"></div>
          <p>fold it. pass it.</p>
          <button class="share-note">PASS TO A FRIEND <span>↗</span></button>
          <button class="copy-note">copy link</button>
          <button class="back-note">back to notebook</button>
          <small>nothing stored. the note lives in this link.</small>
          <a class="studio-mark" href="https://72fstudio.in" target="_blank" rel="noreferrer">a 72F Studio distraction ↗</a>
        </section>
      </div>`)
    const share = app.querySelector<HTMLButtonElement>('.share-note')!
    share.addEventListener('click', async () => {
      if (navigator.share) await navigator.share({ title: `${sender} passed you a note`, text: 'open this. write back.', url })
      else await copy(url)
    })
    const copyButton = app.querySelector<HTMLButtonElement>('.copy-note')!
    copyButton.addEventListener('click', async () => {
      await copy(url)
      copyButton.textContent = 'copied ✓'
    })
    const backdrop = app.querySelector<HTMLElement>('.sheet-backdrop')!
    app.querySelector<HTMLButtonElement>('.back-note')!.addEventListener('click', () => backdrop.remove())
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) backdrop.remove()
    })
  }, 950)
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value)
}

function receive(note: Note) {
  replyTo = note.from
  const aspect = Number.isFinite(note.aspect) ? Math.max(.35, Math.min(1.8, note.aspect!)) : note.layout === 'spread' ? 1.33 : .7
  app.innerHTML = `
    <section class="received">
      <p class="from"><span>${escapeHtml(note.from)}</span> passed you this.</p>
      <div class="received-paper ${note.layout === 'spread' ? 'spread' : ''} unfolding" style="--note-aspect:${aspect}">
        <canvas id="received-canvas" aria-label="A handwritten note from ${escapeHtml(note.from)}"></canvas>
      </div>
      <button class="write-back" type="button">write back <span>↗</span></button>
      <p class="privacy">nothing stored. this note lived only in the link.</p>
    </section>`
  const canvas = app.querySelector<HTMLCanvasElement>('canvas')!
  let strokeIndex = 0
  const replay = () => {
    redraw(canvas, note.strokes.slice(0, strokeIndex))
    if (strokeIndex++ < note.strokes.length) setTimeout(replay, 58)
  }
  const start = () => {
    app.querySelector('.received-paper')!.classList.remove('unfolding')
    setTimeout(replay, 420)
  }
  new ResizeObserver(() => redraw(canvas, note.strokes.slice(0, strokeIndex))).observe(canvas)
  setTimeout(start, 100)
  app.querySelector('button')!.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname)
    strokes = []
    pageFull = false
    sessionStorage.removeItem(STORAGE_KEY)
    sender ? drawPage() : cover(true)
  })
}

const incoming = location.hash.length > 1 ? decode(location.hash.slice(1)) : null
if (incoming) receive(incoming)
else cover()
