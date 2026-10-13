export type WkSubjectType = 'radical' | 'kanji' | 'vocabulary' | 'kana_vocabulary';

export type WkMeaning = { meaning: string; primary: boolean; accepted_answer: boolean };
export type WkAuxMeaning = { meaning: string; type: 'whitelist' | 'blacklist' };
export type WkReading = { reading: string; primary: boolean; accepted_answer: boolean; type?: 'onyomi' | 'kunyomi' | 'nanori' };
export type WkContextSentence = { ja: string; en: string };
export type WkAudio = {
  url: string;
  content_type: string;
  metadata: { gender?: string; pronunciation?: string; voice_actor_name?: string; voice_description?: string };
};
export type WkCharacterImage = { url: string; content_type: string; metadata?: Record<string, unknown> };

export type WkSubject = {
  id: number;
  object: WkSubjectType;
  data_updated_at?: string;
  data: {
    characters: string | null;
    level: number;
    slug: string;
    lesson_position: number;
    hidden_at: string | null;
    document_url?: string;
    meanings: WkMeaning[];
    auxiliary_meanings: WkAuxMeaning[];
    meaning_mnemonic: string;
    meaning_hint?: string | null;
    readings?: WkReading[];
    reading_mnemonic?: string;
    reading_hint?: string | null;
    component_subject_ids?: number[];
    amalgamation_subject_ids?: number[];
    visually_similar_subject_ids?: number[];
    context_sentences?: WkContextSentence[];
    parts_of_speech?: string[];
    pronunciation_audios?: WkAudio[];
    character_images?: WkCharacterImage[];
    spaced_repetition_system_id: number;
  };
};

export type WkSrsStage = { position: number; interval: number | null; interval_unit: string | null };
export type WkSrsSystem = {
  id: number;
  name: string;
  unlocking_stage_position: number;
  starting_stage_position: number;
  passing_stage_position: number;
  burning_stage_position: number;
  stages: WkSrsStage[];
};

export type WkContent = {
  version: 1;
  syncedAt?: string;
  subjects: Record<number, WkSubject>;
  srsSystems: Record<number, WkSrsSystem>;
  maxLevelGranted: number;
  radicalSvgs?: Record<number, string>;
};

export type WkAssignment = {
  subjectId: number;
  stage: number;
  unlockedAt?: number;
  startedAt?: number;
  passedAt?: number;
  burnedAt?: number;
  availableAt?: number;
};

export type WkItemStats = {
  meaningCorrect: number;
  meaningIncorrect: number;
  readingCorrect: number;
  readingIncorrect: number;
};

export type WkNotes = { meaningNote?: string; readingNote?: string; synonyms?: string[] };

export type WkSettings = {
  lessonBatchSize: number;
  maxLevel: number;
  autoplayAudio: boolean;
  voice: 'female' | 'male';
};

export type WkProgress = {
  version: 1;
  level: number;
  levelStartedAt: Record<number, number>;
  assignments: Record<number, WkAssignment>;
  stats: Record<number, WkItemStats>;
  notes: Record<number, WkNotes>;
  settings: WkSettings;
  importedAt?: number;
};

export type QuestionKind = 'meaning' | 'reading';
