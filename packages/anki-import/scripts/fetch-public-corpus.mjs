import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// GitHub distributions supplement the three anonymous AnkiWeb downloads.
// GitHub stars measure repository popularity, NOT individual AnkiWeb deck ratings.
const targets = [
  [
    'goethe-a1',
    'patsytau/anki_german_a1_vocab',
    'Goethe-Institute-A1-Wordlist.apkg',
    'German A1 vocabulary: text and audio',
  ],
  [
    'bayesian',
    'MilesCranmer/anki_science',
    'math_ml_statistics/Bayesian_Statistics.apkg',
    'Bayesian statistics',
  ],
  [
    'probability',
    'MilesCranmer/anki_science',
    'math_ml_statistics/Probability_Theory_and_Mathematical_Statistics.apkg',
    'Probability theory and mathematical statistics',
  ],
  [
    'physics-gre',
    'MilesCranmer/anki_science',
    'physics_and_astronomy/Physics_GRE.apkg',
    'Physics GRE',
  ],
  [
    'astrophysics',
    'MilesCranmer/anki_science',
    'physics_and_astronomy/comprehensive_astrophysics.apkg',
    'Comprehensive astrophysics',
  ],
  ['eth-ml', 'taivop/anki-decks', 'ETH Machine Learning.apkg', 'ETH Machine Learning'],
  [
    'formulate-knowledge',
    'taivop/anki-decks',
    'How-to-Formulate-Knowledge.apkg',
    'How to formulate knowledge',
  ],
]
const releases = [
  [
    'coding-combined',
    'ad-si/Coding-Flashcards',
    'v1.2.0',
    'cards-combined.apkg',
    'Coding Flashcards: six languages',
  ],
  ['kaishi-1.5k', 'donkuri/kaishi', 'v2.4.2', 'Kaishi.1.5k.apkg', 'Kaishi 1.5k'],
]
const directory = resolve(process.argv[2] ?? '.cache/anki-corpus')
await mkdir(directory, { recursive: true })
const repositories = new Map()
async function repository(repo) {
  if (!repositories.has(repo)) {
    const info = await (await fetch(`https://api.github.com/repos/${repo}`)).json()
    const commit = await (await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`)).json()
    if (!commit.sha) throw new Error(`No commit for ${repo}`)
    repositories.set(repo, { commit: commit.sha, stars: info.stargazers_count })
  }
  return repositories.get(repo)
}
async function save(id, title, url, sourceUrl, extra) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error(`${id}: not an APKG ZIP`)
  const meta = {
    id,
    title,
    sourceUrl,
    downloadUrl: url,
    ...extra,
    downloadedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    file: `${id}.apkg`,
  }
  await writeFile(resolve(directory, meta.file), bytes)
  await writeFile(resolve(directory, `${id}.json`), JSON.stringify(meta, null, 2) + '\n')
  console.log(JSON.stringify(meta))
}
for (const [id, repo, path, title] of targets) {
  const info = await repository(repo)
  await save(
    id,
    title,
    `https://raw.githubusercontent.com/${repo}/${info.commit}/${encodeURIComponent(path)}`,
    `https://github.com/${repo}/blob/${info.commit}/${encodeURIComponent(path)}`,
    { repository: repo, repositoryStars: info.stars, commit: info.commit },
  )
}
for (const [id, repo, tag, file, title] of releases) {
  const info = await repository(repo)
  await save(
    id,
    title,
    `https://github.com/${repo}/releases/download/${tag}/${file}`,
    `https://github.com/${repo}/releases/tag/${tag}`,
    { repository: repo, repositoryStars: info.stars, tag },
  )
}
