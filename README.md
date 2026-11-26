# MotherTongue Aid: First 10 Minutes

An open dataset that teaches AI assistants safe emergency first aid in Hausa and Bengali.

**Demo:** https://wst2002.github.io/mothertongue-aid/

**Results at a glance** (80 held-out questions, two judges):

- Given these rows, a model gives dangerous first-aid advice in Hausa 8.8% of the time instead of 48.8% on its own, and in Bengali 2.5–3.8% instead of 26.2% (flagged by either of two judges).
- Compared with a plain machine translation of the same rows, the Adaption rows make the answer open with the right local emergency number 5–11 points more often, with about the same safety and coverage.
- Every one of the 1,212 rows passed automated rule checks and a twice-read model meaning check against the source guidance.

## Why this exists

When someone is choking, bleeding or has stopped breathing, the first ten minutes decide a lot, and help is often further away than that. More and more people in Nigeria, Bangladesh and India ask a phone assistant what to do. They ask in Hausa or Bengali, and the answers they get are often wrong in ways that hurt: the wrong emergency number (111 or 911), techniques that are not in any first-aid guide, or a "do not" warning turned into permission.

MotherTongue Aid is a small instruction dataset (question and answer pairs) built for exactly that moment. Every answer comes from checked public guidance, is written in plain everyday words, starts with the right emergency number for the country, and is available in:

| Code | Language | Emergency number |
|---|---|---|
| `en` | English (reference) | "your local emergency number" |
| `ha-NG` | Hausa, Nigeria | 112 |
| `bn-BD` | Bengali, Bangladesh | 999 |
| `bn-IN` | Bengali, India | 112 |

Who it is for: teams building health, safety or general assistants for Hausa and Bengali speakers, and researchers who need a safety-checked evaluation and training set in these languages.

## What is in the dataset

Emergencies covered: choking (adult, child, baby), heavy bleeding, burns and scalds, drowning, CPR, heat exhaustion and heat stroke, plus questions that ask for a medicine dose or a diagnosis (the answer refuses and sends the person to help).

Files:

- `data/improved/mothertongue_aid.jsonl` and `.csv`: the improved dataset, 1,212 rows (303 questions × 4 languages).
- `data/samples.md`: the same 10 questions before and after, in every language, with English translations of the Hausa and Bengali answers.
- `data/original/seed_en.jsonl` and `.csv`: the original English dataset it was built from (303 rows).
- `evaluation/`: held-out questions, judge reports and Custom Eval results.
- `adaption/`: the Adaption run IDs and the Blueprint text used for each run.
- `docs/`: the web demo, live at **https://wst2002.github.io/mothertongue-aid/**: a dataset explorer. Type an emergency question in any of the four languages and it shows the closest checked row (text matching, no model), compare languages side by side, browse every row.

Columns:

| Column | Meaning |
|---|---|
| `id` | answer key + question number, the same across languages |
| `language` | `en`, `ha-NG`, `bn-BD`, `bn-IN` |
| `scenario`, `age_group`, `intent` | what the row is about |
| `prompt` | the question as a worried person would type it |
| `prompt_source` | `dataset team` or `Adaption Invent a Dataset` (only the question was invented, never the answer) |
| `completion` | the answer |
| `source_url`, `source_section` | the Health New Zealand page and section the answer comes from |
| `licence` | licence of the row |

## Source and licence

Every answer is adapted from Health New Zealand | Te Whatu Ora first-aid pages, which are published under CC BY 4.0 (https://www.healthnz.govt.nz/copyright). Wording was simplified and translated; the steps were not changed. Each row names its source page. The dataset is released under CC BY 4.0 with this credit:

> Adapted from Health New Zealand | Te Whatu Ora first-aid guidance, CC BY 4.0.

The few rows that refuse a medicine dose or diagnosis were written by the dataset team and are also CC BY 4.0. No personal or confidential data is included.

## How Adaption was used

1. **Original dataset.** We wrote the English seed by hand from the Health NZ pages: one checked answer per situation and several real-sounding questions for each.
2. **Invent a Dataset.** Adaption invented 300 new emergency questions. We kept only the question. Two judges from different model families had to agree on which checked answer it belongs to; questions too close to the seed or to our held-out evaluation questions were dropped.
3. **Adaptive Data.** The seed went through Adaptive Data with:
   - `localize` to Hausa (Nigeria) and Bengali (Bangladesh, India), one run per country so the Blueprint can name that country's emergency number, plus an English-only run,
   - the checked answer passed as `context` (`reference_answer`), so the platform rewrites it instead of inventing a new one,
   - `prompt_rephrase` off, so questions stay short and natural,
   - `length: concise`, safety categories `violence` and `self_harm`,
   - a Blueprint (system rules) that keeps every step, its order and every "Do not" line, puts the country's emergency number first, and fixes known Hausa wording mistakes.
4. **Custom Evals.** Our own safety rubric was run inside Adaption (see "Notes on Adaption's scores").
5. **AutoScientist** (optional training). The final 1,212 rows were uploaded as a raw dataset and used to fine-tune `Qwen/Qwen3.5-9B` (LoRA r 16, 1 epoch, learning rate 5e-5, recommended by AutoScientist; one iteration, about 35 minutes). AutoScientist reports a win rate of 21.7% for the tuned model against the base model (target 70%), so we do not claim a model improvement; the dataset evaluation below is our evidence. Run details: `evaluation/autoscientist_run.json`.

## Quality checks on every row

For each question and language, the final file keeps the first adapted version that passes all of these checks:

- **Rule checks**: known harmful drift (111 or New Zealand, 911, abdominal thrusts, "do not give back blows", draining water, medicine doses, Hausa wording errors), rows written in the wrong language, and the emergency number: every Hausa and Bengali row must contain its own country's number and no other country's number or name; English rows must not name a country number.
- **Meaning check**: a judge model compares the adapted answer with its English reference and grades every difference as critical (could change what the rescuer does) or minor. The judge sees the question and the country the row is for, so a step the question rules out (a cut wrist needs "raise the arm", not "the arm or leg") is not counted against the answer. Each row is read twice; one critical finding is enough to reject it.

Rows that fail in every adapted version are sent back through Adaptive Data for their country only, then checked again. It took up to seven rounds of these small runs until every row passed (`adaption/runs.md`).

## Evaluation

**Method.** 80 held-out emergency questions that are not in the dataset, each with a list of steps the answer must include and things it must not say. Each question is asked in English, Hausa (Nigeria), Bengali (Bangladesh) and Bengali (India), and answered by the same model (`gemma-4-26b-a4b-it`) in four ways:

- **plain**: the model alone;
- **original**: the model plus the 3 closest rows of the original English dataset;
- **translated**: the model plus the same 3 original rows, machine-translated into the question's language without Adaption (Hausa and Bengali only). This shows what Adaption adds beyond plain translation;
- **improved**: the model plus the same 3 rows from the improved dataset, in the question's language.

All four use the same retrieved rows (found from the English question), so only the text of the rows changes. Two judges from different model families (`deepseek-v4-flash`, `glm-5.2`) translate each answer to English and check it: 1,200 answers, each judged twice.

**Results** (percent of the 80 questions; where the two judges differ on a column, both are shown as deepseek / glm):

| Language | System | Dangerous advice, either judge ↓ | Dangerous, both judges ↓ | Required steps included ↑ | Emergency number first ↑ |
|---|---|---|---|---|---|
| Hausa (NG) | plain | 48.8 | 22.5 | 31.2 / 30.4 | 5.0 |
|  | original | 15.0 | 5.0 | 81.8 / 82.7 | 55.0 / 57.5 |
|  | translated | 10.0 | 3.8 | 79.3 / 81.0 | 58.8 / 57.5 |
|  | **improved** | 8.8 | 5.0 | 79.3 / 78.8 | 70.0 / 68.8 |
| Bengali (BD) | plain | 26.2 | 13.8 | 52.8 / 54.7 | 7.5 / 8.8 |
|  | original | 3.8 | 0.0 | 84.8 / 85.0 | 56.2 |
|  | translated | 3.8 | 0.0 | 83.9 / 84.2 | 60.0 |
|  | **improved** | 3.8 | 0.0 | 84.0 / 84.7 | 65.0 |
| Bengali (IN) | plain | 26.2 | 12.5 | 50.9 / 53.3 | 12.5 / 16.2 |
|  | original | 5.0 | 0.0 | 85.0 / 85.7 | 52.5 |
|  | translated | 1.2 | 0.0 | 83.2 | 57.5 / 55.0 |
|  | **improved** | 2.5 | 0.0 | 80.0 / 81.5 | 65.0 |
| English | plain | 8.8 | 3.8 | 74.0 / 77.1 | 75.0 / 76.2 |
|  | original | 0.0 | 0.0 | 82.8 / 86.9 | 67.5 / 66.2 |
|  | **improved** | 3.8 | 1.2 | 80.2 / 83.3 | 80.0 |

The judges agree on "dangerous" for 95–99% of the improved and translated answers. Full numbers: `evaluation/report_deepseek.json`, `evaluation/report_glm.json`, `evaluation/report_dangerous_consensus.json`; the translated rows are in `evaluation/translated_baseline_rows.jsonl`.

**What this shows**

- **Against the model alone**, the dataset cuts dangerous answers (flagged by either judge) in Hausa from 48.8% to 8.8%, and in Bengali from 26.2% to 2.5–3.8%, and the share of required steps rises from 30–55% to about 80%.
- **Against plain translation of the same rows**, the Adaption rows open with the right local emergency number 5–11 points more often in every language (Hausa 58.8 → 70.0, Bengali BD 60.0 → 65.0, Bengali IN 57.5 → 65.0). Dangerous answers and required-steps coverage stay about the same as with plain translation.
- **Against the original English rows**, the emergency number improves by 9–15 points and Hausa dangerous answers fall from 15.0% to 8.8%. Required-steps coverage is 1–5 points lower; the Adaption answers are shorter by design (`length: concise`).
- Most remaining dangerous answers come from retrieval picking the wrong emergency (for example bleeding steps for a burn from a motorbike exhaust), which affects all systems equally.

## Runs, settings and iterations

| When (IST) | Run | What changed | Result |
|---|---|---|---|
| 24 Nov 13:07 | pilot v1, 20 rows | first localize run with the source page as context | NZ number 111 leaked into ~29 rows per language, prompts became the whole page |
| 24 Nov 13:20 | pilot v2 | context removed, Blueprint rules for numbers | Bengali fixed, Hausa still had 111 |
| 24 Nov 13:45 | pilot v3 | new upload, `prompt_rephrase` off | numbers and prompts fixed, but answers regenerated from model memory (US abdominal thrusts, "do not hit the back") |
| 24 Nov | pilot v4 | checked answer passed as `reference_answer` context, Blueprint rule "keep exactly its steps" | drift flags 50 → 11 → 0 real |
| 24 Nov evening | full v1, 556 rows | all 139 questions × 4 languages | 0 real drift by regex; held-out eval showed Hausa wording problems |
| 24 Nov night | full v2 / v3 | Blueprint rules 11–13 (warnings keep meaning, back blows between the shoulder blades, Hausa "Ka kira" for call) | Hausa errors 50 → 2; one rule made English rows come out in Hausa, fixed by sending the Hausa rule only with a Hausa locale |
| 25 Nov 00:00 | English redo, 16 rows | English-only run for rows that came out in Hausa | all 16 clean |
| 25 Nov 11:00 | Custom Evals | safety and local-usability rubrics inside Adaption | see "Notes on Adaption's scores" |
| 25 Nov 12:00 | meaning check v1 | judge per row against the reference | CPR call timing and fist with thumb inside found in English rows; Blueprint rules tightened |
| 25 Nov 13:00 | Invent | 300 invented questions, mapped to checked answers by two judges | 164 new questions kept; seed grows to 303 rows |
| 25 Nov 14:00 | full v6, 1,212 rows | 303 rows × 4 languages in one run, tighter Blueprint (call timing, hand position, Hausa "ƙirji") | new check found the emergency number wrong or missing in 540 rows: India rows said Bangladesh's 999, because one Blueprint served both Bengali countries |
| 25 Nov 16:55 | one run per country | Nigeria, Bangladesh, India and English runs, each Blueprint names only its own number | wrong or missing numbers 540 → 13 |
| 25 Nov 20:20 | fix runs 1 and 2 | only the rows that failed every check, re-run per country | 134 → 43 → 23 rows left |
| 25 Nov 22:30 | meaning check v3 | judge sees the question and the row's country, reads each row twice | fewer false rejections, a missed Hausa error ("lift the stomach" for "lift the chin") now caught; 81 rows sent back |
| 26 Nov 12:30 | fix runs 3–7, Blueprint rule 13 | phrases that kept changing named in the Blueprint (cover, not wipe; cool shower, not a bath; head and jaw; tell the operator it is a baby) | 81 → 31 → 13 → 3 → 0 rows left: all 1,212 rows pass |
| 26 Nov 13:20 | evaluation | 80 held-out questions × 4 languages × 3 systems, two judges | see "Evaluation" |

## Notes on Adaption's scores

Adaption's built-in quality score goes down on every run of this dataset, from about 7–8 before to about 4 after (for example the India run: 8.0 → 4.1, grade B → D; screenshot in `evidence/adaption-measure-india.png`). The same pattern shows on runs whose rows pass every check above. The run page lists the language as English and counts 606 rows (303 original + 303 expanded) for a Bengali run. We have not established which text or fields the score reads, so we do not claim that the platform score improved.

Our own safety rubric, run inside Adaption as a Custom Eval on a 100-row sample, shows the same drop: before 9.3–9.7, after 2.7–5.6 on the Nigeria, Bangladesh, India and English runs. The same rubric text, scored by our judge on every row of the final dataset, gives 9.33 for the English seed answers and 9.05 (Hausa), 8.87 (Bengali, Bangladesh), 9.13 (Bengali, India) and 9.12 (English) for the improved rows. Most of the low per-row scores are the judge objecting to "inwards and upwards" chest thrusts, which is the Health New Zealand wording and is also in the seed.

We reported this to Adaption with the run IDs (25 Nov; no reply yet), and on Hackyard's advice we publish both result sets rather than choosing the favourable one: the platform scores here, and our own held-out evaluation above, whose improvement claims stand on their own.

## Limitations

- The answers follow Health New Zealand guidance. Local protocols can add to it (for example India's 108 ambulance line alongside 112).
- Hausa and Bengali rows were checked by judge models, back-translation and rule checks, not yet by native-speaking health workers.
- Five emergencies only: choking, bleeding, burns, drowning with CPR, and heat illness.
- The dataset is for training and testing assistants. It does not replace a first-aid course or an emergency call.

## Team

Wageesha Tripathi (solo).

Made by **Wageesha Tripathi** · [LinkedIn](https://www.linkedin.com/in/wst2002/) · [Email](mailto:tripathiwageesha2002@gmail.com) · [GitHub](https://github.com/WST2002)
