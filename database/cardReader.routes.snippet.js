// Add these to your existing card-reader routes.
// Adjust import/middleware paths to your project.

const biometric = require('./cardReader.biometric.controller');

// IMPORTANT: put /lookup-card and /fingerprint-enrollments BEFORE /:id
router.get('/lookup-card', biometric.lookupCard);
router.get('/fingerprint-enrollments', biometric.fingerprintEnrollments);
