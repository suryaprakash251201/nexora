package auth

import (
	"bytes"
	"encoding/base64"
	"image/png"

	"github.com/pquerna/otp/totp"
)

// TOTPSetup contains the secret, provisioning URI, and QR code (PNG base64).
type TOTPSetup struct {
	Secret string `json:"secret"`
	URI    string `json:"uri"`
	QR     string `json:"qr"`
}

// GenerateTOTPSetup creates a new TOTP secret and returns the provisioning
// info including a QR code image as a base64-encoded PNG.
func GenerateTOTPSetup(accountName, issuer string) (*TOTPSetup, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
	})
	if err != nil {
		return nil, err
	}

	img, err := key.Image(256, 256)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}

	return &TOTPSetup{
		Secret: key.Secret(),
		URI:    key.URL(),
		QR:     "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

// VerifyTOTPCode validates a TOTP passcode against a stored secret.
func VerifyTOTPCode(secret, code string) bool {
	return totp.Validate(code, secret)
}
