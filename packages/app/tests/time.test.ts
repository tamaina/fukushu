import { expect, it } from 'vitest'
import { getStudyDayKey } from '../src/domain/time'
it('uses a 4am local study-day boundary', () => {
  expect(getStudyDayKey(new Date(2026, 0, 2, 3, 59))).toBe('2026-01-01')
  expect(getStudyDayKey(new Date(2026, 0, 2, 4))).toBe('2026-01-02')
})
