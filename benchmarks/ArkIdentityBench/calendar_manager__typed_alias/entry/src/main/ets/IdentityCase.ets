import { calendarManager } from '@kit.CalendarKit';
export function execute(receiver: calendarManager.CalendarManager): void {
  const alias = receiver;
  alias.getAllCalendars();
}
