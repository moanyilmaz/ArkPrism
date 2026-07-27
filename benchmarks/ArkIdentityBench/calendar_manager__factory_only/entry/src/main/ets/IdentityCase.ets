import { calendarManager } from '@kit.CalendarKit';
export async function execute(): Promise<void> {
  const context = undefined as any;
  const receiver = calendarManager.getCalendarManager(context);
  console.info('getAllCalendars', String(receiver));
}
