import { calendarManager } from '@kit.CalendarKit';
class LocalReceiver { getAllCalendars(): void {} }
export function execute(): void {
  new LocalReceiver().getAllCalendars();
}
