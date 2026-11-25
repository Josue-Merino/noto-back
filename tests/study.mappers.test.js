import { describe, it, expect } from 'vitest'
import {
  assembleContent,
  blocksToNotes,
  blocksToRows,
  gradeAttempt,
  latestReview,
  materialRows,
  nextReviewState,
  notesToBlocks,
  orderBlocks,
} from '../src/modules/study/study.mappers.js'

let seq = 0
const newId = () => `id-${++seq}`

describe('study.mappers', () => {
  it('notas → bloques → notas conserva el contenido, los emojis y el idioma', () => {
    const notes = {
      title: 'Photosynthesis',
      language: 'en',
      summary: 'Class summary',
      blocks: [
        { type: 'heading2', text: 'Light phase', emoji: '☀️' },
        { type: 'bullet_list_item', text: 'Chlorophyll', emoji: null },
        { type: 'callout', text: 'Family 👨‍👩‍👧 note', emoji: '👨‍👩‍👧' },
      ],
      actionItems: [],
      supportMaterial: ['Chapter 3'],
      homework: [],
    }

    const blocks = notesToBlocks(notes)
    expect(blocks.map((b) => b.content)).toEqual([
      'Summary', 'Class summary', 'Content', '☀️ Light phase', 'Chlorophyll', '👨‍👩‍👧 Family 👨‍👩‍👧 note', 'Support Material', 'Chapter 3',
    ])
    expect(blocksToNotes('Photosynthesis', blocks)).toEqual(notes)
  })

  it('un tipo de bloque desconocido se guarda como párrafo', () => {
    expect(notesToBlocks({ summary: '', blocks: [{ type: 'image', text: 'x' }] })).toEqual([
      { type: 'heading1', content: 'Contenido' },
      { type: 'paragraph', content: 'x' },
    ])
  })

  it('ordena la lista enlazada aunque las filas lleguen desordenadas, y tolera cadenas rotas', () => {
    const rows = blocksToRows('n1', [1, 2, 3, 4].map((n) => ({ type: 'paragraph', content: `b${n}` })), newId)
    const shuffled = [rows[2], rows[0], rows[3], rows[1]]
    expect(orderBlocks(shuffled).map((r) => r.content)).toEqual(['b1', 'b2', 'b3', 'b4'])

    const broken = shuffled.map((r) => ({ ...r, next_block_id: null, created_at: `2026-01-0${r.content.at(-1)}` }))
    expect(orderBlocks(broken).map((r) => r.content)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('SM-2: "bien" da 1, 6 y luego intervalo × EF; "otra vez" reinicia y deja la tarjeta pendiente', () => {
    const now = new Date('2026-11-25T10:00:00Z')
    const r1 = nextReviewState(null, 'good', now)
    expect(r1).toMatchObject({ repetitions: 1, intervalDays: 1, easeFactor: 2.5 })
    const r2 = nextReviewState(r1, 'good', now)
    expect(r2).toMatchObject({ repetitions: 2, intervalDays: 6 })
    const r3 = nextReviewState(r2, 'easy', now)
    expect(r3).toMatchObject({ repetitions: 3, intervalDays: 15, easeFactor: 2.6 })
    expect(r3.nextReviewAt).toBe('2026-12-10T10:00:00.000Z')

    const again = nextReviewState(r3, 'again', now)
    expect(again).toMatchObject({ repetitions: 0, intervalDays: 0, nextReviewAt: now.toISOString() })
    expect(again.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('califica un intento con las opciones correctas guardadas, no con lo que diga el cliente', () => {
    const preguntas = [
      { pregunta_id: 'p1', opcion: [{ opcion_id: 'o1', es_correcta: true }, { opcion_id: 'o2', es_correcta: false }] },
      { pregunta_id: 'p2', opcion: [{ opcion_id: 'o3', es_correcta: false }, { opcion_id: 'o4', es_correcta: true }] },
      { pregunta_id: 'p3', opcion: [{ opcion_id: 'o5', es_correcta: true }] },
    ]
    const graded = gradeAttempt(
      preguntas,
      [{ questionId: 'p1', optionId: 'o1' }, { questionId: 'p2', optionId: 'o1' }, { questionId: 'p9', optionId: 'o5' }],
      'i1'
    )
    expect(graded).toMatchObject({ correctCount: 1, total: 3, score: 33.33 })
    // La opción de otra pregunta no se guarda como respuesta
    expect(graded.respuestas).toEqual([
      { intento_id: 'i1', pregunta_id: 'p1', opcion_id: 'o1', es_correcta: true },
      { intento_id: 'i1', pregunta_id: 'p2', opcion_id: null, es_correcta: false },
    ])
  })

  it('materialRows + assembleContent: ida y vuelta de flashcards y cuestionario', () => {
    const content = {
      notes: null,
      flashcards: { title: 'Mazo', language: 'es', cards: [{ front: 'A', back: 'B' }, { front: 'C', back: 'D' }] },
      quiz: { title: '', language: 'es', questions: [{ question: '¿?', options: ['x', 'y', 'z'], correctOptionIndex: 2, explanation: '' }] },
    }
    const rows = materialRows('n1', 'Clase', content, newId)
    expect(rows.cuestionario.cuestionario_name).toBe('Clase')

    const assembled = assembleContent({
      note: { title: 'Clase' },
      blocks: [],
      mazos: [{ ...rows.mazo, flashcard: [...rows.flashcards].reverse() }],
      cuestionarios: [{
        ...rows.cuestionario,
        pregunta: rows.preguntas.map((p) => ({ ...p, opcion: rows.opciones.filter((o) => o.pregunta_id === p.pregunta_id).reverse() })),
        intento: [],
      }],
    })
    expect(assembled.notes).toBeNull()
    expect(assembled.flashcards.cards.map((c) => c.front)).toEqual(['A', 'C'])
    expect(assembled.quiz.questions[0]).toMatchObject({ options: ['x', 'y', 'z'], correctOptionIndex: 2 })
  })

  it('latestReview acepta el embebido como objeto (FK única) o como arreglo', () => {
    const row = { ease_factor: 2.6, interval_days: 1, repetitions: 1, next_review_at: 'n', last_reviewed_at: '2026-01-02', created_at: '2026-01-01' }
    const expected = { easeFactor: 2.6, intervalDays: 1, repetitions: 1, nextReviewAt: 'n', lastReviewedAt: '2026-01-02' }
    expect(latestReview(row)).toEqual(expected)
    expect(latestReview([{ ...row, repetitions: 0, last_reviewed_at: '2025-12-31' }, row])).toEqual(expected)
    expect(latestReview(null)).toBeNull()
    expect(latestReview([])).toBeNull()
    const card = assembleContent({
      note: { note_id: 'n1', title: 'T' }, blocks: [],
      mazos: [{ mazo_id: 'm1', mazo_name: 'M', flashcard: [{ flashcard_id: 'f1', orden: 0, frente: 'A', reverso: 'B', flashcard_review: row }] }],
      cuestionarios: [],
    }).flashcards.cards[0]
    expect(card.review).toEqual(expected)
  })
})
