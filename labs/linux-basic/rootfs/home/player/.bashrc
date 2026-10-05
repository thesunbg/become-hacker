# ZERO -> ROOT lab shell.
# Deliberately plain: no aliases that would solve the player's missions for them.

case $- in
    *i*) ;;
      *) return;;
esac

HISTSIZE=1000
HISTFILESIZE=2000
shopt -s histappend checkwinsize

PS1='\[\033[01;32m\]\u@laptop\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
