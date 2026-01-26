import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from 'lucide-react';

interface YearSelectorProps {
  years: number[];
  selectedYear: number | null;
  onYearChange: (year: number) => void;
  disabled?: boolean;
}

const YearSelector: React.FC<YearSelectorProps> = ({
  years,
  selectedYear,
  onYearChange,
  disabled = false,
}) => {
  if (years.length === 0) {
    return null;
  }

  // Sort years descending (most recent first)
  const sortedYears = [...years].sort((a, b) => b - a);

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedYear?.toString() ?? ''}
        onValueChange={(value) => onYearChange(parseInt(value, 10))}
        disabled={disabled || years.length <= 1}
      >
        <SelectTrigger className="h-8 w-[100px] bg-background text-sm">
          <SelectValue placeholder="Jahr" />
        </SelectTrigger>
        <SelectContent>
          {sortedYears.map((year) => (
            <SelectItem key={year} value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default YearSelector;
