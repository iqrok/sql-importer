#!/bin/sh
exec sed -r 's#(self|this)\.##g' $@
