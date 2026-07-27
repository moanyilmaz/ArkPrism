import { calendarManager } from '@kit.CalendarKit';
export function execute(receiver: calendarManager.CalendarManager): void {
  const ref = receiver.getAllCalendars;
  console.info(String(ref));
}
