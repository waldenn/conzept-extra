import Error from '@/data-model/Error';
import PropertyValueRelation from '@/data-model/PropertyValueRelation';
import ConditionRelation from '@/data-model/ConditionRelation';
import ReferenceRelation from '@/data-model/ReferenceRelation';
import ParseResult from '@/data-access/ParseResult';

export const DEFAULT_LIMIT = 10; // CONZEPT PATCH

export default interface RootState {
	conditionRows: ConditionRow[];
	errors: Error[];
	limit: number | null | undefined;
	useLimit: boolean;
	omitLabels: boolean;
}

export interface ItemValue {
	id: string;
	label: string;
}

export type StringValue = string;

export interface QuantityValue {
	value: number;
	precision?: number;
	unit: ItemValue | null;
	rawUnitInput?: string;
}

export interface DateValue {
	parseResult: ParseResult | null;
	formattedValue: string | null;
}

export type Value = ItemValue | StringValue | QuantityValue | DateValue | null;

export interface ConditionRow {
	propertyData: PropertyData;
	valueData: {
		value: Value;
		valueError: Error|null;
	};
	propertyValueRelationData: {
		value: PropertyValueRelation;
	};
	referenceRelation: ReferenceRelation;
	subclasses: boolean;
	// conditionRelation between the current condition and the condition above.
	// If there is only one condition this property = null
	conditionRelation: ConditionRelation | null;
	negate: boolean;
	readonly conditionId: string;
}

export interface PropertyData {
	id: string;
	label: string;
	datatype: string|null;
	propertyError: Error|null;
	isPropertySet: boolean;
}
