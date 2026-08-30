package playlists

import (
	"database/sql"

	"github.com/nexora/nexora/internal/database"
	"fmt"
	"strings"

	"github.com/nexora/nexora/internal/util"
)

type Store struct {
	db *database.DB
}

func NewStore(db *database.DB) *Store {
	return &Store{db: db}
}

type Playlist struct {
	ID          string         `json:"id"`
	UserID      string         `json:"-"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	CoverRootID string         `json:"cover_root_id"`
	CoverPath   string         `json:"cover_path"`
	IsPublic    bool           `json:"is_public"`
	CreatedAt   string         `json:"created_at"`
	UpdatedAt   string         `json:"updated_at"`
	Items       []PlaylistItem `json:"items"`

	// Augmented fields for the frontend (not stored in DB).
	OwnerUsername string `json:"owner_username,omitempty"`
	IsOwner       bool   `json:"is_owner,omitempty"`
	CanEdit       bool   `json:"can_edit,omitempty"`
}

type PlaylistItem struct {
	ID         string `json:"id"`
	PlaylistID string `json:"playlist_id"`
	RootID     string `json:"root_id"`
	Path       string `json:"path"`
	Position   int64  `json:"position,omitempty"`
	CreatedAt  string `json:"created_at"`

	// Augmented fields for frontend convenience (not stored in DB)
	Name      string `json:"name"`
	Extension string `json:"extension"`
	Mime      string `json:"mime"`
	// Size/Modified are hydrated from the search index so clients can
	// classify codecs correctly (lossless FLAC/ALAC detection depends on
	// real file size — a 0 here would mislabel hi-res as plain AAC).
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

type Collaborator struct {
	PlaylistID string `json:"playlist_id"`
	UserID     string `json:"user_id"`
	Role       string `json:"role"`
	CreatedAt  string `json:"created_at"`
	Username   string `json:"username,omitempty"`
}

func (s *Store) ListAll() ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT id, user_id, name, COALESCE(description,''), COALESCE(cover_root_id,''), COALESCE(cover_path,''), COALESCE(is_public,0), created_at, updated_at FROM playlists ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.CoverRootID, &p.CoverPath, &p.IsPublic, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Items = make([]PlaylistItem, 0)
		playlists = append(playlists, p)
	}
	rows.Close()

	if len(playlists) == 0 {
		return playlists, nil
	}

	playlists = s.hydrateItems(playlists)
	return playlists, nil
}

// ListForUser returns the playlists a user can see: the ones they own plus the
// ones shared with them as a collaborator. Each entry carries the owner's
// username and the viewer's ownership/edit flags so the UI can group them and
// gate actions per user.
func (s *Store) ListForUser(userID string) ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT p.id, p.user_id, p.name, COALESCE(p.description,''), COALESCE(p.cover_root_id,''), COALESCE(p.cover_path,''), COALESCE(p.is_public,0), p.created_at, p.updated_at, COALESCE(u.username,''),
		CASE WHEN p.user_id = ? THEN 1 ELSE 0 END,
		CASE WHEN p.user_id = ? THEN 1 ELSE COALESCE((SELECT 1 FROM playlist_collaborators pc WHERE pc.playlist_id = p.id AND pc.user_id = ? AND pc.role = 'editor'), 0) END
		FROM playlists p LEFT JOIN users u ON p.user_id = u.id
		WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM playlist_collaborators pc2 WHERE pc2.playlist_id = p.id AND pc2.user_id = ?)
		ORDER BY p.created_at DESC`, userID, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.CoverRootID, &p.CoverPath, &p.IsPublic, &p.CreatedAt, &p.UpdatedAt, &p.OwnerUsername, &p.IsOwner, &p.CanEdit); err != nil {
			return nil, err
		}
		p.Items = make([]PlaylistItem, 0)
		playlists = append(playlists, p)
	}
	rows.Close()

	if len(playlists) == 0 {
		return playlists, nil
	}

	playlists = s.hydrateItems(playlists)
	return playlists, nil
}

func (s *Store) ListPublic(viewerUserID string) ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT p.id, p.user_id, p.name, COALESCE(p.description,''), COALESCE(p.cover_root_id,''), COALESCE(p.cover_path,''), COALESCE(p.is_public,0), p.created_at, p.updated_at, COALESCE(u.username,''),
		CASE WHEN p.user_id = ? THEN 1 ELSE 0 END,
		CASE WHEN p.user_id = ? THEN 1 ELSE COALESCE((SELECT 1 FROM playlist_collaborators pc WHERE pc.playlist_id = p.id AND pc.user_id = ? AND pc.role = 'editor'), 0) END
		FROM playlists p LEFT JOIN users u ON p.user_id = u.id
		WHERE p.is_public = 1 ORDER BY p.updated_at DESC`, viewerUserID, viewerUserID, viewerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.CoverRootID, &p.CoverPath, &p.IsPublic, &p.CreatedAt, &p.UpdatedAt, &p.OwnerUsername, &p.IsOwner, &p.CanEdit); err != nil {
			return nil, err
		}
		p.Items = make([]PlaylistItem, 0)
		playlists = append(playlists, p)
	}
	rows.Close()

	if len(playlists) == 0 {
		return playlists, nil
	}

	playlists = s.hydrateItems(playlists)
	return playlists, nil
}

func (s *Store) hydrateItems(playlists []Playlist) []Playlist {
	var ids []string
	for _, p := range playlists {
		ids = append(ids, p.ID)
	}
	if len(ids) == 0 {
		return playlists
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT id, playlist_id, root_id, path, COALESCE(position, 0), created_at FROM playlist_items WHERE playlist_id IN (%s) ORDER BY position ASC, created_at ASC`, strings.Join(placeholders, ","))
	itemRows, err := s.db.Query(query, args...)
	if err != nil {
		return playlists
	}
	defer itemRows.Close()

	itemMap := make(map[string][]PlaylistItem)
	for itemRows.Next() {
		var i PlaylistItem
		if err := itemRows.Scan(&i.ID, &i.PlaylistID, &i.RootID, &i.Path, &i.Position, &i.CreatedAt); err != nil {
			continue
		}
		itemMap[i.PlaylistID] = append(itemMap[i.PlaylistID], i)
	}

	for i, p := range playlists {
		if items, ok := itemMap[p.ID]; ok {
			playlists[i].Items = items
		}
	}
	return playlists
}

func (s *Store) Create(userID, name, description string) (*Playlist, error) {
	id := util.RandToken(10)
	now := util.NowUTC()
	_, err := s.db.Exec(`INSERT INTO playlists (id, user_id, name, description, cover_root_id, cover_path, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', 0, ?, ?)`, id, userID, name, description, now, now)
	if err != nil {
		return nil, err
	}
	return &Playlist{
		ID:          id,
		UserID:      userID,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
		Items:       make([]PlaylistItem, 0),
		IsOwner:     true,
		CanEdit:     true,
	}, nil
}

// CreateWithItems atomically creates a playlist and inserts its initial items
// in a single transaction. Either everything persists or nothing does — this
// prevents the "orphan empty playlist" bug where the row was committed but
// seeding items failed.
func (s *Store) CreateWithItems(userID, name, description string, items []PlaylistItem) (*Playlist, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	id := util.RandToken(10)
	now := util.NowUTC()
	if _, err := tx.Exec(`INSERT INTO playlists (id, user_id, name, description, cover_root_id, cover_path, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', 0, ?, ?)`,
		id, userID, name, description, now, now); err != nil {
		return nil, err
	}

	pl := &Playlist{
		ID:          id,
		UserID:      userID,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
		Items:       make([]PlaylistItem, 0),
		IsOwner:     true,
		CanEdit:     true,
	}

	for pos, item := range items {
		itemID := util.RandToken(12)
		res, err := tx.Exec(`INSERT OR IGNORE INTO playlist_items (id, playlist_id, root_id, path, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			itemID, id, item.RootID, item.Path, pos, now)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			pl.Items = append(pl.Items, PlaylistItem{
				ID:         itemID,
				PlaylistID: id,
				RootID:     item.RootID,
				Path:       item.Path,
				Position:   int64(pos),
				CreatedAt:  now,
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return pl, nil
}

func (s *Store) Delete(userID, id string) error {
	_, err := s.db.Exec(`DELETE FROM playlists WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

func (s *Store) Rename(userID, id, name string) error {
	if !s.CanEdit(userID, id) {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	_, err := s.db.Exec(`UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?`, name, util.NowUTC(), id)
	return err
}

// SetDescription updates the playlist description (owner/editors only).
func (s *Store) SetDescription(userID, id, description string) error {
	if !s.CanEdit(userID, id) {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	_, err := s.db.Exec(`UPDATE playlists SET description = ?, updated_at = ? WHERE id = ?`, description, util.NowUTC(), id)
	return err
}

func (s *Store) SetCover(userID, playlistID, coverRootID, coverPath string) error {
	if !s.CanEdit(userID, playlistID) {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	_, err := s.db.Exec(`UPDATE playlists SET cover_root_id = ?, cover_path = ?, updated_at = ? WHERE id = ?`,
		coverRootID, coverPath, util.NowUTC(), playlistID)
	return err
}

func (s *Store) SetPublic(userID, playlistID string, isPublic bool) error {
	val := 0
	if isPublic {
		val = 1
	}
	_, err := s.db.Exec(`UPDATE playlists SET is_public = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		val, util.NowUTC(), playlistID, userID)
	return err
}

// AddItems inserts items using INSERT OR IGNORE to skip duplicates, appending
// each at the next available position so manual ordering is preserved.
// Returns the number of items actually inserted.
func (s *Store) AddItems(userID, playlistID string, items []PlaylistItem) (int, error) {
	var dummy string
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, userID).Scan(&dummy)
	if err != nil {
		if err == sql.ErrNoRows {
			// Check if user is a collaborator
			err2 := s.db.QueryRow(`SELECT playlist_id FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ? AND role = 'editor'`, playlistID, userID).Scan(&dummy)
			if err2 != nil {
				return 0, fmt.Errorf("playlist not found or unauthorized")
			}
		} else {
			return 0, err
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var maxPos int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(position), -1) FROM playlist_items WHERE playlist_id = ?`, playlistID).Scan(&maxPos); err != nil {
		return 0, err
	}

	now := util.NowUTC()
	added := 0
	for _, item := range items {
		maxPos++
		id := util.RandToken(12)
		res, err := tx.Exec(`INSERT OR IGNORE INTO playlist_items (id, playlist_id, root_id, path, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			id, playlistID, item.RootID, item.Path, maxPos, now)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		} else {
			maxPos-- // slot not consumed; keep positions gap-free for the rest
		}
	}

	_, err = tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, now, playlistID)
	if err != nil {
		return 0, err
	}

	return added, tx.Commit()
}

// ReorderItems persists a full ordering of a playlist's tracks. itemIDs must
// contain every item of the playlist in the desired order (the client sends
// the complete list after an optimistic drag-and-drop update).
func (s *Store) ReorderItems(userID, playlistID string, itemIDs []string) error {
	if !s.CanEdit(userID, playlistID) {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	if len(itemIDs) == 0 {
		return fmt.Errorf("item_ids must not be empty")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for i, itemID := range itemIDs {
		if _, err := tx.Exec(`UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?`, i, itemID, playlistID); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, util.NowUTC(), playlistID); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) RemoveItem(userID, playlistID, itemID string) error {
	if !s.CanEdit(userID, playlistID) {
		return fmt.Errorf("playlist not found or unauthorized")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?`, itemID, playlistID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, util.NowUTC(), playlistID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// CanEdit checks if a user is the owner, a collaborator with editor role.
func (s *Store) CanEdit(userID, playlistID string) bool {
	var dummy string
	// Check owner
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, userID).Scan(&dummy)
	if err == nil {
		return true
	}
	// Check collaborator
	err = s.db.QueryRow(`SELECT playlist_id FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ? AND role = 'editor'`, playlistID, userID).Scan(&dummy)
	return err == nil
}

// Collaborator management
func (s *Store) AddCollaborator(ownerID, playlistID, targetUserID, role string) error {
	var dummy string
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, ownerID).Scan(&dummy)
	if err != nil {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	_, err = s.db.Exec(`INSERT OR REPLACE INTO playlist_collaborators (playlist_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		playlistID, targetUserID, role, util.NowUTC())
	return err
}

func (s *Store) RemoveCollaborator(ownerID, playlistID, targetUserID string) error {
	var dummy string
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, ownerID).Scan(&dummy)
	if err != nil {
		return fmt.Errorf("playlist not found or unauthorized")
	}
	_, err = s.db.Exec(`DELETE FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ?`, playlistID, targetUserID)
	return err
}

func (s *Store) ListCollaborators(playlistID string) ([]Collaborator, error) {
	rows, err := s.db.Query(`SELECT pc.playlist_id, pc.user_id, pc.role, pc.created_at, COALESCE(u.username,'') FROM playlist_collaborators pc LEFT JOIN users u ON pc.user_id = u.id WHERE pc.playlist_id = ?`, playlistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var collabs []Collaborator
	for rows.Next() {
		var c Collaborator
		if err := rows.Scan(&c.PlaylistID, &c.UserID, &c.Role, &c.CreatedAt, &c.Username); err != nil {
			return nil, err
		}
		collabs = append(collabs, c)
	}
	if collabs == nil {
		collabs = make([]Collaborator, 0)
	}
	return collabs, nil
}
