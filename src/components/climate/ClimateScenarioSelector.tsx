import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClimateScenario, CLIMATE_SCENARIOS } from './types';
import { Thermometer } from 'lucide-react';

interface ClimateScenarioSelectorProps {
  value: ClimateScenario;
  onChange: (value: ClimateScenario) => void;
  disabled?: boolean;
}

const ClimateScenarioSelector: React.FC<ClimateScenarioSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const selectedScenario = CLIMATE_SCENARIOS.find((s) => s.value === value);

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Thermometer className="h-3 w-3" />
        Klimaszenario
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as ClimateScenario)} disabled={disabled}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Szenario wählen">
            {selectedScenario?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CLIMATE_SCENARIOS.map((scenario) => (
            <SelectItem key={scenario.value} value={scenario.value}>
              <div className="flex flex-col py-0.5">
                <span className="font-medium">{scenario.label}</span>
                <span className="text-xs text-muted-foreground">{scenario.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ClimateScenarioSelector;
