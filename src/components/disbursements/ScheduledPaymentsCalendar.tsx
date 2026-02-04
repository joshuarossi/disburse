import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getChainName } from '@/lib/chains';

interface ScheduledPayment {
  _id: string;
  beneficiary?: { name: string; walletAddress: string } | null;
  displayAmount?: string;
  amount?: string;
  token: string;
  scheduledAt?: number;
  chainId?: number;
}

interface ScheduledPaymentsCalendarProps {
  payments: ScheduledPayment[];
  onClose: () => void;
}

interface DayCell {
  date: Date;
  dayKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  payments: ScheduledPayment[];
  dayTotal: number;
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatBalance(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDayKey(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function ScheduledPaymentsCalendar({ payments, onClose }: ScheduledPaymentsCalendarProps) {
  const { t } = useTranslation();
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const changeMonth = (direction: -1 | 1) => {
    setViewedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    setSelectedDay(null);
  };

  // Group payments by local date key
  const paymentsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPayment[]>();
    for (const p of payments) {
      if (!p.scheduledAt) continue;
      const key = getDayKey(new Date(p.scheduledAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [payments]);

  // Derive the grid of day cells for the viewed month
  const dayCells: DayCell[] = useMemo(() => {
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const totalDays = lastOfMonth.getDate();

    // Monday-based offset: Mon=0 ... Sun=6
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const trailingDays = (7 - ((mondayOffset + totalDays) % 7)) % 7;

    const todayKey = getDayKey(new Date());
    const cells: DayCell[] = [];

    // Leading fill days (previous month)
    for (let i = mondayOffset - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      const key = getDayKey(date);
      const dayPayments = paymentsByDay.get(key) ?? [];
      cells.push({
        date,
        dayKey: key,
        dayNumber: date.getDate(),
        isCurrentMonth: false,
        isToday: key === todayKey,
        payments: dayPayments,
        dayTotal: dayPayments.reduce((s, p) => s + parseFloat(p.displayAmount ?? p.amount ?? '0'), 0),
      });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(year, month, d);
      const key = getDayKey(date);
      const dayPayments = paymentsByDay.get(key) ?? [];
      cells.push({
        date,
        dayKey: key,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: key === todayKey,
        payments: dayPayments,
        dayTotal: dayPayments.reduce((s, p) => s + parseFloat(p.displayAmount ?? p.amount ?? '0'), 0),
      });
    }

    // Trailing fill days (next month)
    for (let i = 1; i <= trailingDays; i++) {
      const date = new Date(year, month + 1, i);
      const key = getDayKey(date);
      const dayPayments = paymentsByDay.get(key) ?? [];
      cells.push({
        date,
        dayKey: key,
        dayNumber: date.getDate(),
        isCurrentMonth: false,
        isToday: key === todayKey,
        payments: dayPayments,
        dayTotal: dayPayments.reduce((s, p) => s + parseFloat(p.displayAmount ?? p.amount ?? '0'), 0),
      });
    }

    return cells;
  }, [viewedMonth, paymentsByDay]);

  // Payments for the selected day
  const selectedDayPayments = useMemo(() => {
    if (!selectedDay) return [];
    return paymentsByDay.get(selectedDay) ?? [];
  }, [selectedDay, paymentsByDay]);

  const monthName = viewedMonth.toLocaleString('default', { month: 'long' });
  const year = viewedMonth.getFullYear();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: month nav + close */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => changeMonth(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold text-white w-44 text-center">
              {monthName} {year}
            </h2>
            <button
              onClick={() => changeMonth(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="h-8 flex items-center justify-center text-xs text-slate-500 font-medium">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {dayCells.map((cell) => {
            const isClickable = cell.isCurrentMonth && cell.payments.length > 0;
            const isSelected = selectedDay === cell.dayKey;

            return (
              <button
                key={cell.dayKey}
                type="button"
                disabled={!isClickable}
                onClick={() => {
                  if (!isClickable) return;
                  setSelectedDay(isSelected ? null : cell.dayKey);
                }}
                className={cn(
                  'relative flex flex-col items-center justify-center h-12 w-full rounded-lg transition-colors',
                  !cell.isCurrentMonth && 'opacity-40 cursor-default',
                  cell.isCurrentMonth && !isClickable && 'cursor-default',
                  isClickable && 'cursor-pointer hover:bg-accent-500/10',
                  cell.isToday && 'ring-1 ring-accent-500',
                  isSelected && 'bg-accent-500/15',
                )}
              >
                <span className={cn('text-sm', cell.isCurrentMonth ? 'text-white' : 'text-slate-500')}>
                  {cell.dayNumber}
                </span>
                {cell.payments.length > 0 && cell.isCurrentMonth && (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-400 mt-0.5" />
                    <span className="text-[10px] font-mono text-accent-400 leading-tight">
                      ${formatBalance(cell.dayTotal)}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected day payment list */}
        {selectedDay && selectedDayPayments.length > 0 && (
          <div className="mt-5 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('default', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {selectedDayPayments.map((p) => (
                <div
                  key={p._id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-navy-800/50 p-2.5 sm:p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white truncate">
                      {p.beneficiary?.name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : '—'}
                      {p.chainId != null && ` · ${getChainName(p.chainId)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm text-white">
                      {p.displayAmount ?? p.amount ?? '0'} {p.token}
                    </span>
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-500/10 text-yellow-400">
                      {t('status.scheduled')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
