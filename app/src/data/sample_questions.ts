export type QuestionType = 'map_tap' | 'flag_match' | 'capital_mcq'

export type Bounds = {
  west: number
  south: number
  east: number
  north: number
}

export type FlagSpec = {
  colors: string[]
  direction: 'horizontal' | 'vertical'
}

export type Question = {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
  correctIndex?: number
  targetBounds?: Bounds
  flag?: FlagSpec
}

export const sampleQuestions: Question[] = [
  {
    id: 'map-japan',
    type: 'map_tap',
    prompt: 'Tap the map to select Japan.',
    targetBounds: {
      west: 129.0,
      south: 31.0,
      east: 146.0,
      north: 46.0,
    },
  },
  {
    id: 'flag-italy',
    type: 'flag_match',
    prompt: 'Which country matches this flag?',
    options: ['Italy', 'France', 'Ireland', 'Mexico'],
    correctIndex: 0,
    flag: {
      colors: ['#1f8f3a', '#ffffff', '#d62828'],
      direction: 'vertical',
    },
  },
  {
    id: 'capital-france',
    type: 'capital_mcq',
    prompt: 'What is the capital of France?',
    options: ['Paris', 'Lyon', 'Marseille', 'Toulouse'],
    correctIndex: 0,
  },
]
