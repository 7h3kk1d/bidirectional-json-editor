import fc from 'fast-check'

/** Depth/size-bounded plain JSON values: nasty numbers, escapes, empties. */
export const arbJson: fc.Arbitrary<unknown> = fc.letrec<{ json: unknown; scalar: unknown }>(
  (tie) => ({
    scalar: fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc
        .oneof(
          fc.integer(),
          fc.constantFrom(0, 1e3, 1.5, -2.25, 1e-7, 123456789.123),
          fc.double({ noNaN: true, noDefaultInfinity: true }),
        )
        // -0 cannot survive JSON.stringify; normalize it out of test data
        .map((n) => (Object.is(n, -0) ? 0 : n)),
      fc.string({ maxLength: 12 }),
      fc.constantFrom('', 'a\nb', 'tab\tsep', 'q"q', 'back\\slash', 'unié☃\u{1f600}'),
    ),
    json: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      tie('scalar'),
      fc.array(tie('json'), { maxLength: 5 }),
      fc
        .array(fc.tuple(fc.string({ maxLength: 6 }), tie('json')), { maxLength: 5 })
        .map((pairs) => Object.fromEntries(pairs)),
    ),
  }),
).json

const arbWs = fc.oneof(
  fc.constant(''),
  fc.constant(' '),
  fc.constant('  '),
  fc.constant('\n'),
  fc.constant('\n  '),
  fc.constant('\t'),
  fc.constant(' \r\n '),
)

/** Serialize a JSON value with randomized (but valid) whitespace. */
export function arbTextOf(value: unknown): fc.Arbitrary<string> {
  // A generator-per-position would be expensive; sample a whitespace "style
  // pool" and pick pseudo-randomly by a seeded counter for determinism.
  return fc.tuple(fc.array(arbWs, { minLength: 1, maxLength: 8 }), fc.nat()).map(([pool, salt]) => {
    let k = salt
    const ws = () => pool[k++ % pool.length]
    const go = (x: unknown): string => {
      if (x === null) return 'null'
      switch (typeof x) {
        case 'string':
          return JSON.stringify(x)
        case 'number':
          return JSON.stringify(x)
        case 'boolean':
          return String(x)
        case 'object': {
          if (Array.isArray(x)) {
            if (x.length === 0) return `[${ws()}]`
            return `[${ws()}${x.map((v) => go(v)).join(`${ws()},${ws()}`)}${ws()}]`
          }
          const entries = Object.entries(x as Record<string, unknown>)
          if (entries.length === 0) return `{${ws()}}`
          return `{${ws()}${entries
            .map(([key, v]) => `${JSON.stringify(key)}${ws()}:${ws()}${go(v)}`)
            .join(`${ws()},${ws()}`)}${ws()}}`
        }
        default:
          throw new Error('unreachable')
      }
    }
    return ws() + go(value) + ws()
  })
}

/** Formatted JSON text of a random value. */
export const arbFormattedText: fc.Arbitrary<string> = arbJson.chain(arbTextOf)

/** A single text edit within `text`, biased toward token boundaries. */
export function arbTextEdit(text: string): fc.Arbitrary<{ from: number; to: number; insert: string }> {
  const positions: number[] = [0, text.length]
  for (let i = 0; i < text.length; i++) {
    if ('{}[],:"'.includes(text[i])) {
      positions.push(i, i + 1)
    }
  }
  const arbPos = fc.oneof(
    fc.nat({ max: text.length }),
    fc.constantFrom(...positions),
  )
  return fc
    .tuple(
      arbPos,
      arbPos,
      fc.oneof(
        fc.constant(''),
        fc.string({ maxLength: 6 }),
        fc.constantFrom(' ', '\n', ',', '"', '1', 'true', 'null', '[]', '{"k":1}', ': '),
      ),
    )
    .map(([a, b, insert]) => ({ from: Math.min(a, b), to: Math.max(a, b), insert }))
}
