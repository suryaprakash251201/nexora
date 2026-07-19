package playlists

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/nexora/nexora/internal/util"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

type Playlist struct {
	ID          string         `json:"id"`
	UserID      string         `json:"-"`
	Name        string         `json:"name"`
	CoverRootID string         `json:"cover_root_id"`
	CoverPath   string         `json:"cover_path"`
	IsPublic    bool           `json:"is_public"`
	CreatedAt   string         `json:"created_at"`
	UpdatedAt   string         `json:"updated_at"`
	Items       []PlaylistItem `json:"items"`
}

type PlaylistItem struct {
	ID         string `json:"id"`
	PlaylistID string `json:"playlist_id"`
	RootID     string `json:"root_id"`
	Path       string `json:"path"`
	CreatedAt  string `json:"created_at"`

	// Augmented fields for frontend convenience (not stored in DB)
	Name      string `json:"name"`
	Extension string `json:"extension"`
	Mime      string `json:"mime"`
}

type Collaborator struct {
	PlaylistID string `json:"playlist_id"`
	UserID     string `json:"user_id"`
	Role       string `json:"role"`
	CreatedAt  string `json:"created_at"`
	Username   string `json:"username,omitempty"`
}

func (s *Store) ListAll() ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT id, user_id, name, COALESCE(cover_root_id,''), COALESCE(cover_path,''), COALESCE(is_public,0), created_at, updated_at FROM playlists ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.CoverRootID, &p.CoverPath, &p.IsPublic, &p.CreatedAt, &p.UpdatedAt); err != nil {
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

func (s *Store) ListPublic() ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT id, user_id, name, COALESCE(cover_root_id,''), COALESCE(cover_path,''), created_at, updated_at FROM playlists WHERE is_public = 1 ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		p.IsPublic = true
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.CoverRootID, &p.CoverPath, &p.CreatedAt, &p.UpdatedAt); err != nil {
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

	query := fmt.Sprintf(`SELECT id, playlist_id, root_id, path, created_at FROM playlist_items WHERE playlist_id IN (%s) ORDER BY created_at ASC`, strings.Join(placeholders, ","))
	itemRows, err := s.db.Query(query, args...)
	if err != nil {
		return playlists
	}
	defer itemRows.Close()

	itemMap := make(map[string][]PlaylistItem)
	for itemRows.Next() {
		var i PlaylistItem
		if err := itemRows.Scan(&i.ID, &i.PlaylistID, &i.RootID, &i.Path, &i.CreatedAt); err != nil {
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

func (s *Store) Create(userID, name string) (*Playlist, error) {
	id := util.RandToken(10)
	now := util.NowUTC()
	_, err := s.db.Exec(`INSERT INTO playlists (id, user_id, name, cover_root_id, cover_path, is_public, created_at, updated_at) VALUES (?, ?, ?, '', '', 0, ?, ?)`, id, userID, name, now, now)
	if err != nil {
		return nil, err
	}
	return &Playlist{
		ID:        id,
		UserID:    userID,
		Name:      name,
		CreatedAt: now,
		UpdatedAt: now,
		Items:     make([]PlaylistItem, 0),
	}, nil
}

func (s *Store) Delete(userID, id string) error {
	_, err := s.db.Exec(`DELETE FROM playlists WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

func (s *Store) Rename(userID, id, name string) error {
	_, err := s.db.Exec(`UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`, name, util.NowUTC(), id, userID)
	return err
}

func (s *Store) SetCover(userID, playlistID, coverRootID, coverPath string) error {
	_, err := s.db.Exec(`UPDATE playlists SET cover_root_id = ?, cover_path = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		coverRootID, coverPath, util.NowUTC(), playlistID, userID)
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

// AddItems inserts items using INSERT OR IGNORE to skip duplicates.
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

	now := util.NowUTC()
	added := 0
	for _, item := range items {
		id := util.RandToken(12)
		res, err := tx.Exec(`INSERT OR IGNORE INTO playlist_items (id, playlist_id, root_id, path, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, playlistID, item.RootID, item.Path, now)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}

	_, err = tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, now, playlistID)
	if err != nil {
		return 0, err
	}

	return added, tx.Commit()
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
