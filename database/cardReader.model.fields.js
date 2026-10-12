/**
 * Add these fields to your existing CardReader model/schema.
 * Do NOT remove your current fields.
 */
fingerprintTemplate: {
  type: String,
  default: null,
  select: false, // normal list APIs should not expose biometric templates
},
fingerprintFormat: {
  type: String,
  default: 'ZK10',
},
