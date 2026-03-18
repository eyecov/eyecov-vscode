<?php

function headline(string $value): string
{
    $trimmed = trim($value);

    return strtoupper($trimmed);
}
