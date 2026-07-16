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
	ID        string           `json:"id"`
	UserID    string           `json:"-"`
	Name      string           `json:"name"`
	CreatedAt string           `json:"created_at"`
	UpdatedAt string           `json:"updated_at"`
	Items     []PlaylistItem `json:"items"`
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

func (s *Store) List(userID string) ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at, updated_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var playlists []Playlist
	for rows.Next() {
		var p Playlist
		p.UserID = userID
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Items = make([]PlaylistItem, 0)
		playlists = append(playlists, p)
	}
	rows.Close()

	if len(playlists) == 0 {
		return playlists, nil
	}

	var playlistIDs []string
	for _, p := range playlists {
		playlistIDs = append(playlistIDs, "'"+p.ID+"'")
	}
	
	query := fmt.Sprintf(`SELECT id, playlist_id, root_id, path, created_at FROM playlist_items WHERE playlist_id IN (%s) ORDER BY created_at ASC`, strings.Join(playlistIDs, ","))
	itemRows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	itemMap := make(map[string][]PlaylistItem)
	for itemRows.Next() {
		var i PlaylistItem
		if err := itemRows.Scan(&i.ID, &i.PlaylistID, &i.RootID, &i.Path, &i.CreatedAt); err != nil {
			return nil, err
		}
		itemMap[i.PlaylistID] = append(itemMap[i.PlaylistID], i)
	}

	for i, p := range playlists {
		if items, ok := itemMap[p.ID]; ok {
			playlists[i].Items = items
		}
	}

	return playlists, nil
}

func (s *Store) Create(userID, name string) (*Playlist, error) {
	id := util.RandToken(10)
	now := util.NowUTC()
	_, err := s.db.Exec(`INSERT INTO playlists (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, id, userID, name, now, now)
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

func (s *Store) AddItems(userID, playlistID string, items []PlaylistItem) error {
	var dummy string
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, userID).Scan(&dummy)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("playlist not found or unauthorized")
		}
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := util.NowUTC()
	for _, item := range items {
		id := util.RandToken(12)
		_, err := tx.Exec(`INSERT INTO playlist_items (id, playlist_id, root_id, path, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, playlistID, item.RootID, item.Path, now)
		if err != nil {
			return err
		}
	}
	
	_, err = tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, now, playlistID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) RemoveItem(userID, playlistID, itemID string) error {
	var dummy string
	err := s.db.QueryRow(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`, playlistID, userID).Scan(&dummy)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("playlist not found or unauthorized")
		}
		return err
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
