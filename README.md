# Singapore Primary Maths Knowledge Graph

An unofficial prerequisite graph of the **Singapore MOE 2021 Primary Mathematics syllabus (P1–P6)**. It shows every syllabus topic, its learning outcomes in MOE's own words, and which earlier topics it builds on.

**Live:** https://ashwath-ramesh.github.io/sg-primary-maths-graph/

**v1:** 66 topics · 202 learning outcomes · 95 prerequisite links.

## Source

All topic names and learning outcomes come from MOE's official syllabus:

- **Document:** *Mathematics Syllabus, Primary One to Six* (2021 syllabus, updated October 2025), Curriculum Planning and Development Division, Ministry of Education, Singapore. Content is in Section 5, pp. 31–44.
- **Original on the MOE website:** [2021-Primary-Mathematics-Syllabus-P1-to-P6-Updated-October-2025.pdf](https://www.moe.gov.sg/api/media/92bff26d-b2b4-4535-b868-b8415c744b91/2021-Primary-Mathematics-Syllabus-P1-to-P6-Updated-October-2025.pdf)
- **MOE syllabus page:** https://www.moe.gov.sg/primary/curriculum/syllabus
- **Unmodified copy in this repo:** [`source/`](source/2021-Primary-Mathematics-Syllabus-P1-to-P6-Updated-October-2025.pdf), sha256 `e8f77fe10d768e2ad5266dfc39a8821674be7eb1c81bc545ba4b841b12ae70e1`

The PDF's own notice reads: *"© Copyright 2025 Curriculum Planning and Development Division. This publication is not for sale. Permission is granted to reproduce this publication in its entirety for personal and non-commercial use only, All rights reserved."* This project is free and non-commercial. Always check MOE's site for the current version.

**This project is not affiliated with or endorsed by the Ministry of Education.** The syllabus doesn't say which topics depend on which, so every prerequisite link here is my own editorial judgment.

## How to read it

- **Graph:** one column per level (P1 to P6) and one band per strand. Click a topic to trace it. Solid lines show what it **builds on**; dashed lines show what it **unlocks**. The side panel lists the topic's outcomes and the reason for each link.
- **Topics:** a sortable, filterable table with one row per topic.
- **Links:** every prerequisite link with its reason, so each one can be reviewed.

Deep links work: `#P5.PC.1`, `#/graph/P6.RA.1`, `#/topics/P3.FR.1`, `#/links`.

If a link looks wrong, please [open an issue](https://github.com/ashwath-ramesh/sg-primary-maths-graph/issues).

## Rules for links (v1)

1. **Hard only.** A learner can't do the later topic without the earlier one.
2. **Direct only.** If A → B → C, there is no separate A → C link.
3. **Earlier or same level.** A prerequisite never sits at a later level.
4. **Explained.** Every link has a one-line reason.
5. **When in doubt, leave it out.**

There are two kinds of link. A *progression* link joins the same idea at the next level, such as Numbers up to 100 → Numbers up to 1000. A *cross-topic* link means an outcome directly uses another skill, such as area of a rectangle needing multiplication.

## Files

```
source/                   MOE syllabus PDF, unmodified
data/topics.json          66 topics with verbatim outcomes (source of truth)
data/dependencies.json    95 prerequisite links with reasons (source of truth)
data/manifest.json        generated: counts, code tables, checksums
schema/*.schema.json      JSON Schema for the two data files
scripts/build.mjs         validator and generator (Node, no dependencies)
docs/index.html           the viewer (vanilla JS + SVG), served by GitHub Pages
docs/data.js              generated bundle the viewer loads
```

After editing anything in `data/`, run:

```sh
node scripts/build.mjs          # validate, then write data/manifest.json and docs/data.js
node scripts/build.mjs --check  # validate only
```

The build fails on duplicate or malformed IDs, unknown topics, self-loops, prerequisites at a later level, missing reasons and cycles. It warns about redundant links.

To view the graph locally, open `docs/index.html` in a browser. It needs no server and works offline.

## Data model

```jsonc
// data/topics.json → topics[]
{
  "id": "P3.FR.1",                 // <Level>.<SubStrand>.<n>, n = syllabus numbering
  "level": "P3",
  "strand": "Number and Algebra",
  "subStrand": "Fractions",
  "name": "Equivalent fractions",  // verbatim heading
  "sourcePage": 35,
  "outcomes": [
    { "id": "P3.FR.1.1", "text": "equivalent fractions" }
  ]
}

// data/dependencies.json → dependencies[]   (topicId builds on prerequisiteId)
{ "topicId": "P3.FR.2", "prerequisiteId": "P3.FR.1", "strength": "hard",
  "reason": "Adding related fractions first rewrites one as an equivalent fraction" }
```

## Not yet

- Outcome-level links (which outcome builds on which), starting with P1–P3
- The Foundation Mathematics track (P5–P6)
- `soft` (helpful but not required) links
- A crosswalk to other curricula, such as US Common Core

The data shape follows Marble's open [os-taxonomy](https://github.com/withmarbleapp/os-taxonomy), and the modelling follows the knowledge-graph chapter of *The Math Academy Way*.
