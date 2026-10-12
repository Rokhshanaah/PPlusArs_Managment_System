// In your existing create/update controller, after multer has parsed multipart/form-data:
const fingerprintTemplate = req.body.fingerprintTemplate
  ? String(req.body.fingerprintTemplate)
  : undefined;

const fingerprintFormat = req.body.fingerprintFormat
  ? String(req.body.fingerprintFormat)
  : 'ZK10';

// CREATE:
const row = await CardReader.create({
  // ...your existing fields
  fingerprintTemplate: fingerprintTemplate || null,
  fingerprintFormat,
});

// UPDATE:
const patch = {
  // ...your existing fields
};

if (fingerprintTemplate) {
  patch.fingerprintTemplate = fingerprintTemplate;
  patch.fingerprintFormat = fingerprintFormat;
}

await CardReader.findByIdAndUpdate(req.params.id, patch, { new: true });
