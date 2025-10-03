import moderateImageHandler from '../api-routes/moderate-image.js';\n\nexport default async function handler(req, res) {\n  return moderateImageHandler(req, res);\n}\n
