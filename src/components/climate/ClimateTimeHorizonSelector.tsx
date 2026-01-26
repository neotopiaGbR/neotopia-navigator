import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClimateTimeHorizon, CLIMATE_TIME_HORIZONS } from './types';
import { Calendar } from 'lucide-react';

interface ClimateTimeHorizonSelectorProps {
  value: ClimateTimeHorizon;
  onChange: (value: ClimateTimeHorizon) => void;
  disabled?: boolean;
}

const ClimateTimeHorizonSelector: React.FC<ClimateTimeHorizonSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const selectedHorizon = CLIMATE_TIME_HORIZONS.find((h) => h.value === value);

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Calendar className="h-3 w-3" />
        Zeithorizont
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as ClimateTimeHorizon)} disabled={disabled}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Zeitraum wählen">
            {selectedHorizon?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CLIMATE_TIME_HORIZONS.map((horizon) => (
            <SelectItem key={horizon.value} value={horizon.value}>
              <span className="font-medium">{horizon.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ClimateTimeHorizonSelector;
