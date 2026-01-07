import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const isNotEmpty = (...propertyNames: string[]): JSONSchema7 => {
  const properties = {};
  propertyNames.forEach(
    (property) =>
      (properties[property] = {
        minLength: 1,
        description: `The "${property}" cannot be empty`,
      }),
  );
  return {
    if: {
      propertyNames: {
        enum: [...propertyNames],
      },
    },
    then: { properties },
  };
};

export const companyCreateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
  },
  required: ['name'],
  ...isNotEmpty('name'),
};
