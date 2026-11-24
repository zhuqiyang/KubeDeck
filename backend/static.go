package main

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var embeddedWeb embed.FS

func webFiles() fs.FS {
	files, err := fs.Sub(embeddedWeb, "web/dist")
	if err != nil {
		panic(err)
	}
	return files
}
