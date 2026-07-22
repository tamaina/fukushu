export interface Clock {
  now(): Date
}
export const systemClock: Clock = { now: () => new Date() }
export function getStudyDayKey(date: Date, rolloverHour = 4): string {
  const shifted = new Date(date)
  shifted.setHours(shifted.getHours() - rolloverHour)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`
}
