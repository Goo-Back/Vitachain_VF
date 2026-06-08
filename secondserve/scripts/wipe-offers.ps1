# Wipes all documents from the /offers collection in Firestore.
# Use this once after switching to Cloudinary uploads, since older offers
# contain broken blob: / localhost image URLs.
#
# Run:  pwsh scripts/wipe-offers.ps1
# Or:   powershell -File scripts/wipe-offers.ps1
#
# Requires you to be logged in via: npx firebase login

$ErrorActionPreference = 'Stop'

$projectId = 'secondserve-bcccd'
$collection = 'offers'

Write-Host "About to DELETE all documents in /$collection on project $projectId" -ForegroundColor Yellow
$confirm = Read-Host "Type 'DELETE' to proceed"
if ($confirm -ne 'DELETE') {
  Write-Host "Aborted." -ForegroundColor Red
  exit 1
}

npx firebase firestore:delete $collection `
  --project $projectId `
  --recursive `
  --force

if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. /$collection is empty." -ForegroundColor Green
} else {
  Write-Host "firestore:delete failed (exit $LASTEXITCODE)" -ForegroundColor Red
  exit $LASTEXITCODE
}
