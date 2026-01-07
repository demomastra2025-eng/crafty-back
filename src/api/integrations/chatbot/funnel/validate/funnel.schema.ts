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

export const funnelSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    goal: { type: 'string' },
    logic: { type: 'string' },
    followUpEnable: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'active', 'archived'] },
    stages: { type: 'array', items: { type: 'object' } },
  },
  required: ['name', 'goal', 'stages'],
  allOf: [
    {
      properties: {
        stages: { type: 'array', items: { type: 'object' }, minItems: 1 },
      },
    },
  ],
  ...isNotEmpty('name', 'goal'),
};

export const funnelUpdateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    goal: { type: 'string' },
    logic: { type: 'string' },
    followUpEnable: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'active', 'archived'] },
    stages: { type: 'array', items: { type: 'object' } },
  },
  allOf: [
    {
      properties: {
        stages: { type: 'array', items: { type: 'object' }, minItems: 1 },
      },
    },
  ],
};

export const funnelSessionSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
    funnelId: { type: ['string', 'null'] },
    funnelStage: { type: 'integer', minimum: 0 },
    followUpStage: { type: 'integer', minimum: 0 },
    funnelEnable: { type: 'boolean' },
    followUpEnable: { type: 'boolean' },
    resetStages: { type: 'boolean' },
  },
  required: ['remoteJid'],
  ...isNotEmpty('remoteJid'),
};
