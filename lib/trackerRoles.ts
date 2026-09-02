import type { Habit, Tracker, TrackerType } from "./trackers";

/**
 * What each of this account's trackers is actually *about*.
 *
 * Trackers here are free-form: the person types the name, picks a type and a
 * category, and that is the whole schema. So the health page cannot read a
 * field called "hydration" — there is no such field, and there never will be.
 * One person logs "Water", the next logs "Hydration", the next logs "পানি",
 * and a fourth counts glasses in a tracker called "Drink". They are all the
 * same input to the same arithmetic, and something has to say so.
 *
 * That is this file. A **role** is the health engine's name for an input —
 * `water`, `junk`, `sitting`, `clean` — and a role map says which of your
 * trackers fills it. Roles are found three ways, kept apart on purpose
 * because they are trusted differently:
 *
 * 1. **Rules** (here, and offline). Name words in the spellings people
 *    actually use, plus the type, category, unit and habit flag. Pure and
 *    tested, so the page works with no API key, no network and no waiting.
 * 2. **AI** (`lib/roleAI.ts`). Asked once per change to the tracker list, and
 *    only ever asked to *label* — never to compute. It reads a list of names
 *    and answers with roles. Every number on the health page is still
 *    arithmetic in `lib/health.ts`, which is the rule the coach card has kept
 *    since it was built and the reason a clumsy generation cannot make a
 *    figure lie.
 * 3. **You**. An override set on the page wins over both, forever, because
 *    the person who named the tracker knows what it is.
 *
 * A role nothing fills is **reported missing and dropped from the weighting**
 * — never scored as though it were a perfect day. That is the same rule
 * `lib/cortisol.ts` keeps about its own sources, and it is the difference
 * between "you are doing well" and "we cannot see you".
 */

export type Role =
  | "sleep"
  | "water"
  | "diet"
  | "junk"
  | "exercise"
  | "steps"
  | "mood"
  | "stress"
  | "energy"
  | "sitting"
  | "screen"
  | "outdoors"
  | "caffeine"
  | "smoking"
  | "clean"
  | "meditation"
  | "prayer"
  | "weight";

/** Where an assignment came from, in increasing order of authority. */
export type RoleSource = "rule" | "ai" | "manual";

export type RoleSpec = {
  id: Role;
  label: string;
  /** One line: what the health engine does with it. Shown on the page. */
  feeds: string;
  /** Whether several trackers can fill this role at once (movement, sitting). */
  many: boolean;
  /**
   * Tracker types that can plausibly carry it. Empty means any type will do.
   * A type outside this list disqualifies the tracker outright — a 1-5 scale
   * is not a count of glasses however it is named.
   */
  types: TrackerType[];
  /**
   * True when the *type alone* is near-conclusive: there is one sleep type,
   * one prayer type, and `streak` exists for nothing but a clean streak.
   */
  signature?: boolean;
  /** How a day's several entries combine into one number. */
  aggregate: "sum" | "avg";
  /** Share of the coverage meter this role carries. */
  weight: number;
  /** Words people actually use, in the spellings they actually use them. */
  words: string[];
  /** Words that rule it out even when something else matched. */
  not?: string[];
  /** Categories that support it. Never required — a category is a hint. */
  categories?: string[];
  /** The habit flag this role expects, when it expects one. */
  habit?: Habit;
  /** Units that support it. */
  units?: string[];
  /** What to say when nothing fills it, and why it is worth adding. */
  suggest: { title: string; why: string };
  /** Roles nobody should be nagged about adding — private, or niche. */
  quiet?: boolean;
};

/**
 * The roles, as data.
 *
 * One array defines the matcher, the AI's vocabulary, the coverage meter and
 * the tests, so what is detected and what is scored cannot drift apart — the
 * same shape `lib/cortisolCheck.ts` uses for its thirty questions, and for
 * the same reason.
 */
export const ROLES: RoleSpec[] = [
  {
    id: "sleep",
    label: "Sleep",
    feeds:
      "Every rhythm on this page. The cortisol curve is anchored to your wake time, so without this there is no curve — only a total.",
    many: false,
    types: ["sleep"],
    signature: true,
    aggregate: "avg",
    weight: 0.2,
    words: ["sleep", "slept", "night", "bed", "ghum", "ghoom"],
    categories: ["sleep", "health"],
    suggest: {
      title: "Add a sleep tracker",
      why: "It is the axis, not one input among several. Bedtime and wake time place your whole day on the clock; a nightly total cannot.",
    },
  },
  {
    id: "water",
    label: "Water",
    feeds:
      "Hydration, measured against a target worked out from your own body weight rather than the eight-glasses folklore.",
    many: false,
    types: ["count", "measure", "check"],
    aggregate: "sum",
    weight: 0.07,
    words: [
      "water",
      "hydrat",
      "drink",
      "fluid",
      "glass",
      "bottle",
      "পানি",
      "pani",
      "jol",
    ],
    not: ["junk", "soda", "cola", "energy drink", "alcohol", "coffee", "tea"],
    categories: ["food", "health"],
    units: ["glass", "glasses", "gilas", "ml", "l", "litre", "liter", "bottle"],
    suggest: {
      title: "Add a water tracker",
      why: "Count glasses. The app already knows how many you need — 30-35 ml per kg of body weight — so the moment it can see the count it can tell you whether you are short and by how much.",
    },
  },
  {
    id: "diet",
    label: "Diet quality",
    feeds: "The nutrition reading, and the cortisol model's food term.",
    many: false,
    types: ["scale"],
    aggregate: "avg",
    weight: 0.07,
    words: [
      "diet",
      "food",
      "nutrition",
      "eating",
      "meal",
      "khabar",
      "khaowa",
      "clean eating",
    ],
    not: ["junk", "mood", "stress", "energy", "sleep", "water"],
    categories: ["food", "health"],
    suggest: {
      title: "Add a diet-quality rating",
      why: "A 1-5 scale in Food, rated once a day. One tap, and it is the only thing that separates a week of real meals from a week of whatever was nearest.",
    },
  },
  {
    id: "junk",
    label: "Junk food",
    feeds:
      "The nutrition reading and the metabolic-drift estimate. Sugar and fried food are read as load, not as sin.",
    many: false,
    types: ["count", "check", "streak"],
    aggregate: "sum",
    weight: 0.07,
    words: [
      "junk",
      "sugar",
      "sweet",
      "fast food",
      "fried",
      "processed",
      "soda",
      "cola",
      "candy",
      "chocolate",
      "dessert",
      "snack",
      "cheat",
      "outside food",
      "street food",
      "bad food",
      "unhealthy",
      "burger",
      "pizza",
      "misti",
      "mishti",
      "chips",
    ],
    habit: "bad",
    categories: ["food", "health", "discipline"],
    suggest: {
      title: "Add a junk-food count, marked as a habit you are cutting",
      why: "The habit flag is what tells junk from water — both are counts in Food, and only the flag says which direction is winning.",
    },
  },
  {
    id: "exercise",
    label: "Movement",
    feeds:
      "The movement reading against the 150 min/week guideline, and it is the single biggest thing that offsets a day spent sitting.",
    many: true,
    types: ["duration", "count", "check"],
    aggregate: "sum",
    weight: 0.09,
    words: [
      "workout",
      "exercise",
      "gym",
      "run",
      "jog",
      "walk",
      "cycle",
      "cycling",
      "swim",
      "sport",
      "training",
      "cardio",
      "lift",
      "weights",
      "push up",
      "pushup",
      "pull up",
      "yoga",
      "stretch",
      "football",
      "cricket",
      "badminton",
      "hike",
      "khela",
    ],
    categories: ["fitness", "health"],
    suggest: {
      title: "Add a movement tracker",
      why: "Movement is read as a U — none at all and far too much both push the rhythm, and the ordinary half-hour in between is the floor. With nothing logged the model cannot tell which of the three you are.",
    },
  },
  {
    id: "steps",
    label: "Steps",
    feeds:
      "Movement, as the background kind — the walking that happens without being called exercise.",
    many: false,
    types: ["count", "measure"],
    aggregate: "sum",
    weight: 0.03,
    words: ["step", "pedometer", "footstep"],
    units: ["steps", "step"],
    categories: ["fitness", "health"],
    suggest: {
      title: "Add a step count",
      why: "Most people's movement is not in the gym. Around 7,000 a day is where most of the benefit has shown up in the cohort data, and a count is the only way this page can see it.",
    },
  },
  {
    id: "mood",
    label: "Mood",
    feeds:
      "The mind reading, and the cortisol model's evening slope — a persistently low mood tracks a flatter one.",
    many: false,
    types: ["scale"],
    aggregate: "avg",
    weight: 0.06,
    words: ["mood", "happy", "happiness", "feel", "feeling", "emotion", "wellbeing"],
    not: ["stress", "anxiety", "energy", "diet", "food"],
    categories: ["health", "other", "discipline"],
    suggest: {
      title: "Add a mood scale",
      why: "A daily 1-5 beats a typed average, because it moves. It is also the input that turns a flat fortnight from a number into an explanation.",
    },
  },
  {
    id: "stress",
    label: "Stress",
    feeds:
      "The mind reading and the burnout estimate — the one input here that is about pressure rather than behaviour.",
    many: false,
    types: ["scale"],
    aggregate: "avg",
    weight: 0.05,
    words: [
      "stress",
      "anxiety",
      "anxious",
      "tension",
      "overwhelm",
      "pressure",
      "worry",
      "chinta",
    ],
    categories: ["health", "other"],
    suggest: {
      title: "Add a stress scale",
      why: "Everything else here infers pressure from what you did. This asks. When the two disagree, that disagreement is the most useful thing on the page.",
    },
  },
  {
    id: "energy",
    label: "Energy",
    feeds:
      "The mind reading. A flat rhythm and a flat afternoon usually arrive together, and this is how the page can tell.",
    many: false,
    types: ["scale"],
    aggregate: "avg",
    weight: 0.04,
    words: ["energy", "energetic", "tired", "fatigue", "alert", "awake", "sluggish"],
    categories: ["health", "other"],
    suggest: {
      title: "Add an energy scale",
      why: "The modelled curve says when your energy should dip. A rated one says when it actually did, and the gap between them is worth reading.",
    },
  },
  {
    id: "sitting",
    label: "Sitting / desk time",
    feeds:
      "The sedentary reading — back and neck strain, and the sitting half of the eye-strain estimate.",
    many: true,
    types: ["duration"],
    aggregate: "sum",
    weight: 0.09,
    words: [
      "study",
      "read",
      "book",
      "class",
      "lecture",
      "tuition",
      "tution",
      "coaching",
      "homework",
      "assignment",
      "exam",
      "revision",
      "edit",
      "video edit",
      "code",
      "coding",
      "program",
      "develop",
      "design",
      "write",
      "writing",
      "work",
      "office",
      "desk",
      "laptop",
      "computer",
      "meeting",
      "freelance",
      "client",
      "porasona",
      "porashona",
    ],
    not: ["walk", "gym", "workout", "sleep"],
    categories: ["study", "work", "other"],
    suggest: {
      title: "Time your desk work",
      why: "Editing, tuition, reading and coding are the same posture for hours, and the risk this page can actually calculate is the one that comes from how long that goes on unbroken. Without a timed tracker there is nothing to count.",
    },
  },
  {
    id: "screen",
    label: "Screen time",
    feeds:
      "Eye strain, and the evening screen term that blunts the next morning's cortisol response.",
    many: true,
    types: ["duration", "count"],
    aggregate: "sum",
    weight: 0.06,
    words: [
      "screen",
      "phone",
      "mobile",
      "social",
      "scroll",
      "youtube",
      "tiktok",
      "instagram",
      "facebook",
      "twitter",
      "reels",
      "netflix",
      "series",
      "game",
      "gaming",
      "doomscroll",
    ],
    not: ["study", "work", "code"],
    categories: ["discipline", "other", "health"],
    suggest: {
      title: "Add a screen-time tracker",
      why: "Screens carry two separate costs here: the eyes during the day and the awakening response the next morning. Neither is visible without a number.",
    },
  },
  {
    id: "outdoors",
    label: "Daylight / outdoors",
    feeds:
      "The rhythm reading. Morning daylight is the strongest single cue your body clock gets, and this is the only way to see whether yours arrives.",
    many: false,
    types: ["duration", "check", "count"],
    aggregate: "sum",
    weight: 0.04,
    words: [
      "outdoor",
      "outside",
      "sun",
      "sunlight",
      "daylight",
      "nature",
      "fresh air",
      "garden",
      "morning light",
    ],
    categories: ["health", "fitness", "other"],
    suggest: {
      title: "Add a daylight or outdoors tracker",
      why: "Twenty minutes of morning light does more for a body clock than any of the advice on this page. Even a yes/no is enough to see whether it is happening.",
    },
  },
  {
    id: "caffeine",
    label: "Caffeine",
    feeds:
      "Sleep pressure and the substance reading. Coffee at six is a sleep problem before it is anything else.",
    many: false,
    types: ["count", "measure"],
    aggregate: "sum",
    weight: 0.04,
    words: ["coffee", "tea", "caffeine", "espresso", "latte", "energy drink", "cha"],
    categories: ["food", "health"],
    suggest: {
      title: "Add a coffee or tea count",
      why: "400 mg still measurably shortens sleep six hours later. The hour matters more than the count, and the count is what the app can hold.",
    },
  },
  {
    id: "smoking",
    label: "Smoking",
    feeds:
      "The substance reading. Nicotine raises cortisol directly, which is one of the few things on this page that is not indirect.",
    many: false,
    types: ["count", "check", "streak"],
    aggregate: "sum",
    weight: 0.03,
    words: ["smok", "cigarette", "cig", "vape", "nicotine", "tobacco", "beedi", "hookah"],
    habit: "bad",
    categories: ["health", "discipline"],
    quiet: true,
    suggest: {
      title: "Add a cigarette count if it applies",
      why: "Only worth adding if it is true of you. Nicotine raises cortisol directly rather than through sleep or food, so it changes the reading more than most inputs.",
    },
  },
  {
    id: "clean",
    label: "Clean streak",
    feeds:
      "The discipline reading, and the timing check — a late-night pattern shows up as a later bedtime, which is what this page can actually measure.",
    many: true,
    types: ["streak"],
    signature: true,
    aggregate: "sum",
    weight: 0.04,
    words: [
      "clean",
      "streak",
      "nofap",
      "fap",
      "pmo",
      "porn",
      "urge",
      "relapse",
      "abstain",
      "quit",
      "sober",
    ],
    categories: ["discipline", "health"],
    quiet: true,
    suggest: {
      title: "Add a clean streak if you keep one",
      why: "Private to your account like everything else here. It is read for two things only — whether the streak is holding, and whether slip days run late enough to move your bedtime. Nothing on this page moralises about it.",
    },
  },
  {
    id: "meditation",
    label: "Meditation / breathing",
    feeds:
      "Recovery. It is the one input here that lowers the evening floor directly rather than by tiring you out.",
    many: false,
    types: ["duration", "check", "count"],
    aggregate: "sum",
    weight: 0.03,
    words: [
      "meditat",
      "mindful",
      "breath",
      "calm",
      "dhikr",
      "zikr",
      "tasbih",
      "journal",
    ],
    categories: ["health", "faith", "other"],
    suggest: {
      title: "Add a breathing or meditation tracker",
      why: "Ten minutes is enough to show up here. Unlike exercise it lowers the evening floor without adding load, which is why it is scored separately.",
    },
  },
  {
    id: "prayer",
    label: "Prayer",
    feeds:
      "Rhythm regularity. Five fixed times a day is a body clock whether or not it was meant as one.",
    many: false,
    types: ["prayer"],
    signature: true,
    aggregate: "avg",
    // Zero on purpose. Prayer is detected so it is not mislabelled as
    // something else, but nothing on the health page reads it yet — and a
    // role that claims coverage while feeding no number makes the "feeding
    // the numbers above" bar a lie.
    weight: 0,
    words: ["prayer", "namaz", "salah", "salat", "pray"],
    categories: ["faith"],
    quiet: true,
    suggest: {
      title: "Add the five prayers",
      why: "Fajr in particular anchors a morning to the sun rather than to an alarm, and this page reads any fixed daily anchor as regularity.",
    },
  },
  {
    id: "weight",
    label: "Body weight",
    feeds:
      "BMI, and the water target — which is 30-35 ml per kg, so it cannot be worked out without one.",
    many: false,
    types: ["measure"],
    aggregate: "avg",
    weight: 0.04,
    words: ["weight", "body weight", "mass", "ozon", "wozon"],
    not: ["lift", "dumbbell"],
    units: ["kg", "lb", "lbs", "pound"],
    categories: ["health", "fitness"],
    suggest: {
      title: "Add a body-weight tracker",
      why: "Two things here need it and neither can guess: BMI, and the water target, which is millilitres per kilogram of you.",
    },
  },
];

export const ROLE_IDS: Role[] = ROLES.map((r) => r.id);

export function roleSpec(id: Role): RoleSpec | null {
  return ROLES.find((r) => r.id === id) ?? null;
}

export function roleLabel(id: Role): string {
  return roleSpec(id)?.label ?? id;
}

/** Sum of every role's weight — the denominator the coverage meter uses. */
export const TOTAL_ROLE_WEIGHT = ROLES.reduce((sum, r) => sum + r.weight, 0);

/* ----------------------------- the assignment ---------------------------- */

export type Assignment = {
  trackerId: string;
  role: Role;
  source: RoleSource;
  /** 0-1. Rules earn theirs from how much matched; a manual one is certain. */
  confidence: number;
  /** Why this tracker, in a few words. Shown on the page, never guessed at. */
  why: string;
};

export type RoleMap = {
  assignments: Assignment[];
  /** The tracker list this map was computed for — see `signatureOf`. */
  signature: string;
  /** When the AI last ran over this list, if it ever has. */
  aiAt: string | null;
};

export const EMPTY_MAP: RoleMap = { assignments: [], signature: "", aiAt: null };

/** Every tracker id filling a role, in assignment order. */
export function trackersFor(map: RoleMap, role: Role): string[] {
  return map.assignments.filter((a) => a.role === role).map((a) => a.trackerId);
}

/** The single tracker filling a role, or null. First wins for `many` roles. */
export function trackerFor(map: RoleMap, role: Role): string | null {
  return trackersFor(map, role)[0] ?? null;
}

export function roleOf(map: RoleMap, trackerId: string): Assignment | null {
  return map.assignments.find((a) => a.trackerId === trackerId) ?? null;
}

export function hasRole(map: RoleMap, role: Role): boolean {
  return map.assignments.some((a) => a.role === role);
}

/**
 * A stable fingerprint of everything the matcher reads.
 *
 * The AI runs when this changes and not otherwise. Renaming a tracker or
 * flipping its habit flag is exactly the kind of change that should re-ask;
 * logging a day, reordering the list or recolouring one is not, and on a free
 * tier capped at a thousand requests a day that distinction is the whole
 * reason this function exists.
 */
export function signatureOf(trackers: Tracker[]): string {
  return trackers
    .filter((t) => !t.archived)
    .map((t) =>
      [
        t.id,
        t.name.trim().toLowerCase(),
        t.type,
        t.unit,
        t.category ?? "",
        t.habit ?? "",
      ].join("|")
    )
    .sort()
    .join("\n");
}

/* ------------------------------ the matcher ------------------------------ */

/**
 * Lowercase, punctuation to spaces, so "video-editing" and "video editing"
 * match.
 *
 * **Marks are kept.** Dropping everything that is not a letter or a number
 * looks right and quietly destroys Indic text: the vowel signs in "পানি" are
 * combining marks rather than letters, so stripping them turned the Bengali
 * for water into two consonants and a gap, and the word never matched. This
 * app is used in Bangladesh; that is not an edge case.
 */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim()} `;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a word appears at the start of a word in the text.
 *
 * Prefix rather than whole-word on purpose: "hydrat" has to catch
 * "hydration", "meditat" has to catch "meditating", and "smok" has to catch
 * both "smoke" and "smoking". The cost is the occasional false positive on a
 * shared stem, which a `not` list handles where it matters.
 */
function hits(text: string, word: string): boolean {
  return new RegExp(`\\s${escape(word.toLowerCase())}`, "u").test(text);
}

/** How well one tracker fits one role. 0 means it does not. */
export function scoreFit(t: Tracker, spec: RoleSpec): number {
  if (spec.types.length > 0 && !spec.types.includes(t.type)) return 0;

  const name = normalize(t.name);
  const unit = normalize(t.unit ?? "");
  const category = (t.category ?? "").toLowerCase();

  if (spec.not?.some((w) => hits(name, w))) return 0;

  let score = 0;

  // The type alone carries a signature role: there is exactly one sleep type
  // and one prayer type, and `streak` exists for nothing but a clean streak.
  if (spec.signature) score += 4;

  const matched = spec.words.filter((w) => hits(name, w)).length;
  if (matched > 0) score += 4 + Math.min(2, matched - 1);

  if (spec.categories?.includes(category)) score += 2;
  if (spec.habit && t.habit === spec.habit) score += 1.5;
  // A bad-habit flag on a role that never wants one is evidence against it:
  // nobody is cutting down on water.
  if (!spec.habit && t.habit === "bad") score -= 1.5;
  if (spec.units?.some((u) => hits(unit, u))) score += 1;

  return score > 0 ? score : 0;
}

/** Below this a rule match is a coincidence, not a detection. */
const RULE_FLOOR = 4;

/**
 * Assign roles from the rules alone.
 *
 * Greedy over every (tracker, role) pair by score, which matters when one
 * tracker could plausibly fill two roles. The strongest single claim wins,
 * the tracker is spent, and the loser looks for another.
 *
 * A tracker holds **one** role. Two would double-count it: an hour of "Video
 * editing" counted as both sitting and screen is two hours of sedentary time
 * that never happened.
 */
export function guessRoles(trackers: Tracker[]): Assignment[] {
  const live = trackers.filter((t) => !t.archived);

  const pairs: { t: Tracker; spec: RoleSpec; score: number }[] = [];
  for (const t of live) {
    for (const spec of ROLES) {
      const score = scoreFit(t, spec);
      if (score >= RULE_FLOOR) pairs.push({ t, spec, score });
    }
  }
  // Highest score first; ties break on the role's weight so the input that
  // matters more claims the tracker, then on id so the answer is stable.
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      b.spec.weight - a.spec.weight ||
      a.t.id.localeCompare(b.t.id)
  );

  const taken = new Set<string>();
  const filled = new Set<Role>();
  const out: Assignment[] = [];

  for (const { t, spec, score } of pairs) {
    if (taken.has(t.id)) continue;
    if (!spec.many && filled.has(spec.id)) continue;
    taken.add(t.id);
    filled.add(spec.id);
    out.push({
      trackerId: t.id,
      role: spec.id,
      source: "rule",
      confidence: Math.min(1, Math.round((score / 9) * 100) / 100),
      why: whyRule(t, spec),
    });
  }
  return out;
}

function whyRule(t: Tracker, spec: RoleSpec): string {
  const name = normalize(t.name);
  const word = spec.words.find((w) => hits(name, w));
  if (word) return `matched "${word}" in the name`;
  if (spec.signature) return `the only thing a ${t.type} tracker can be`;
  return "matched on type and category";
}

/* ------------------------------- the merge ------------------------------- */

/**
 * Rules, then AI, then you.
 *
 * Authority runs one way and only one way. A manual choice is never
 * overruled — it is the person who named the tracker telling the app what it
 * is, and nothing here knows better. The AI fills what the rules missed and
 * may correct a *weak* rule match (`AI_OVERRIDE_BELOW`), because a confident
 * keyword hit is better evidence than a language model's opinion about the
 * same keyword. Above that line the rules stand.
 */
export const AI_OVERRIDE_BELOW = 0.7;

export function mergeRoles(
  rule: Assignment[],
  ai: Assignment[],
  manual: Assignment[]
): Assignment[] {
  const out: Assignment[] = [];
  const taken = new Set<string>();
  const filled = new Map<Role, number>();

  const canTake = (a: Assignment) => {
    const spec = roleSpec(a.role);
    if (!spec) return false;
    if (taken.has(a.trackerId)) return false;
    if (!spec.many && (filled.get(a.role) ?? 0) > 0) return false;
    return true;
  };
  const take = (a: Assignment) => {
    taken.add(a.trackerId);
    filled.set(a.role, (filled.get(a.role) ?? 0) + 1);
    out.push(a);
  };

  for (const a of manual) if (canTake(a)) take(a);

  // An AI answer only displaces a rule the rules themselves were unsure of.
  const weak = new Set(
    rule.filter((a) => a.confidence < AI_OVERRIDE_BELOW).map((a) => a.trackerId)
  );
  for (const a of rule) if (!weak.has(a.trackerId) && canTake(a)) take(a);
  for (const a of ai) if (canTake(a)) take(a);
  for (const a of rule) if (canTake(a)) take(a);

  return out;
}

/** Manual overrides as stored: tracker id → role, or `null` for "not this". */
export type Overrides = Record<string, Role | null>;

export function overridesToAssignments(
  overrides: Overrides,
  trackers: Tracker[]
): Assignment[] {
  const live = new Set(trackers.filter((t) => !t.archived).map((t) => t.id));
  const out: Assignment[] = [];
  for (const [trackerId, role] of Object.entries(overrides)) {
    if (!role || !live.has(trackerId) || !ROLE_IDS.includes(role)) continue;
    out.push({
      trackerId,
      role,
      source: "manual",
      confidence: 1,
      why: "you set this",
    });
  }
  return out;
}

/**
 * Only known roles, and only for trackers that still exist.
 *
 * **Archived counts as existing.** This is written back wholesale on every
 * override, so dropping archived trackers here would permanently erase the
 * label somebody set on a tracker they later retired — and un-archiving it
 * would silently hand it back to the guesser. `overridesToAssignments` is
 * what filters to live trackers, at the point where it matters.
 */
export function cleanOverrides(raw: unknown, trackers: Tracker[]): Overrides {
  if (!raw || typeof raw !== "object") return {};
  const live = new Set(trackers.map((t) => t.id));
  const out: Overrides = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!live.has(id)) continue;
    if (value === null) out[id] = null;
    else if (typeof value === "string" && ROLE_IDS.includes(value as Role)) {
      out[id] = value as Role;
    }
  }
  return out;
}

/**
 * The whole pipeline, minus the AI call itself. Pure, so it is testable.
 *
 * A tracker the reader has muted (`null` in the overrides) is removed from
 * the rule and AI lists before the merge rather than after — otherwise it
 * would keep winning its role and keep being dropped, and the role would
 * read as filled while nothing filled it.
 */
export function buildMap(
  trackers: Tracker[],
  ai: Assignment[],
  overrides: Overrides,
  aiAt: string | null = null
): RoleMap {
  const muted = new Set(
    Object.entries(overrides)
      .filter(([, role]) => role === null)
      .map(([id]) => id)
  );
  const keep = (list: Assignment[]) => list.filter((a) => !muted.has(a.trackerId));

  return {
    assignments: mergeRoles(
      keep(guessRoles(trackers)),
      keep(ai),
      overridesToAssignments(overrides, trackers)
    ),
    signature: signatureOf(trackers),
    aiAt,
  };
}

/* ------------------------------- coverage -------------------------------- */

export type MissingRole = {
  role: Role;
  label: string;
  title: string;
  why: string;
  weight: number;
  quiet: boolean;
};

/**
 * What the page cannot see, worst gap first.
 *
 * `quiet` roles are listed but never pushed: nobody should be nagged to add
 * a cigarette count, and a clean streak is the reader's business. They are
 * offered where they belong and left alone otherwise.
 */
export function missingRoles(map: RoleMap): MissingRole[] {
  return ROLES.filter((spec) => !hasRole(map, spec.id))
    .map((spec) => ({
      role: spec.id,
      label: spec.label,
      title: spec.suggest.title,
      why: spec.suggest.why,
      weight: spec.weight,
      quiet: spec.quiet === true,
    }))
    .sort((a, b) => Number(a.quiet) - Number(b.quiet) || b.weight - a.weight);
}

/** 0-100: how much of what the health page asks for it can actually see. */
export function roleCoverage(map: RoleMap): number {
  const seen = ROLES.filter((spec) => hasRole(map, spec.id)).reduce(
    (sum, spec) => sum + spec.weight,
    0
  );
  return Math.round((seen / TOTAL_ROLE_WEIGHT) * 100);
}
