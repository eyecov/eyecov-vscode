package sample

func Add(left int, right int) int {
	return left + right
}

func Clamp(value int) int {
	if value < 0 {
		return 0
	}

	return value
}
