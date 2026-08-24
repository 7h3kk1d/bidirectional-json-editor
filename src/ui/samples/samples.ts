export interface Sample {
  name: string
  text: string
}

const users = `{
  "users": [
    {
      "name": "Ada",
      "age": 36,
      "admin": true,
      "tags": ["math", "compute"],
      "address": {
        "city": "London",
        "zip": "N1 9GU"
      }
    },
    {
      "name": "Grace",
      "age": 85,
      "admin": false,
      "tags": ["navy", "cobol"],
      "address": {
        "city": "Arlington",
        "zip": "22201"
      }
    },
    {
      "name": "Alan",
      "age": 41,
      "admin": true,
      "tags": ["logic", "enigma"],
      "address": null
    }
  ],
  "total": 3,
  "page": 1,
  "meta": {
    "generated": "2026-08-24T12:00:00Z",
    "source": "sample",
    "flags": [true, false, null],
    "ratios": [1e3, 1.0, 0.5]
  }
}
`

const config = `{
  "server": { "host": "localhost", "port": 8080, "tls": false },
  "logging": { "level": "info", "file": null },
  "features": ["mirroring", "incremental-put", "labels"],
  "limits": { "maxBody": 1048576, "timeoutMs": 30000 }
}
`

const edge = `{
  "empty-object": {},
  "empty-array": [],
  "escapes": "line\\nbreak \\"quoted\\" tab\\there ☃",
  "unicode": "😀 astral",
  "numbers": [0, -0.5, 1e3, 1.0, 1e-7, 123456789.123456789],
  "dup": 1,
  "dup": 2,
  "deep": { "a": { "b": { "c": { "d": [ { "e": null } ] } } } }
}
`

function bigArray(): string {
  const items: string[] = []
  for (let i = 0; i < 5000; i++) {
    items.push(
      `    { "id": ${i}, "name": "item-${i}", "active": ${i % 3 === 0}, "score": ${(i * 7919) % 1000} }`,
    )
  }
  return `{\n  "items": [\n${items.join(',\n')}\n  ],\n  "count": 5000\n}\n`
}

export const samples: Sample[] = [
  { name: 'users', text: users },
  { name: 'config', text: config },
  { name: 'edge cases', text: edge },
  { name: 'large (5k rows)', text: bigArray() },
]

export const defaultSample = users
